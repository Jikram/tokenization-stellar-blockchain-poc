#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env};

const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO: u32 = 3_110_400; // ~6 months at 5s/ledger

#[contracttype]
enum DataKey {
    Admin,
    Price,
}

/// Emitted whenever the admin sets a new NAV price.
/// price is in cents: 100_000 = $1,000.00
#[contractevent]
pub struct PriceUpdated {
    pub admin: Address,
    pub price: i128,
    pub ledger: u32,
    pub timestamp: u64,
}

/// Emitted when the admin clears the price (used to demo oracle failure).
#[contractevent]
pub struct PriceCleared {
    pub admin: Address,
    pub ledger: u32,
    pub timestamp: u64,
}

#[contract]
pub struct NavOracleContract;

#[contractimpl]
impl NavOracleContract {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("contract already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        Self::extend_ttl(&env);
    }

    pub fn get_admin(env: Env) -> Address {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    /// Set the NAV price in cents. 100_000 = $1,000.00. Must be positive.
    pub fn update_price(env: Env, admin: Address, price: i128) {
        Self::require_admin(&env, &admin);
        if price <= 0 {
            panic!("price must be positive");
        }
        env.storage().persistent().set(&DataKey::Price, &price);
        Self::extend_ttl(&env);
        PriceUpdated {
            admin,
            price,
            ledger: env.ledger().sequence(),
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }

    /// Returns the current NAV price in cents. Panics if no price has been set.
    /// Called cross-contract by the token contract during mint/burn/clawback.
    pub fn get_price(env: Env) -> i128 {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Price)
            .unwrap_or_else(|| panic!("oracle has no price set"))
    }

    /// Returns true if a price has been set.
    pub fn has_price(env: Env) -> bool {
        Self::extend_ttl(&env);
        env.storage().persistent().has(&DataKey::Price)
    }

    /// Removes the price. Demonstrates oracle failure: subsequent mint/burn/clawback
    /// calls will revert the entire transaction atomically.
    pub fn clear_price(env: Env, admin: Address) {
        Self::require_admin(&env, &admin);
        env.storage().persistent().remove(&DataKey::Price);
        Self::extend_ttl(&env);
        PriceCleared {
            admin,
            ledger: env.ledger().sequence(),
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
    }
}

impl NavOracleContract {
    fn require_admin(env: &Env, admin: &Address) {
        let stored: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if &stored != admin {
            panic!("only admin can call this function");
        }
    }

    fn extend_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        if env.storage().persistent().has(&DataKey::Admin) {
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Admin, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        if env.storage().persistent().has(&DataKey::Price) {
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Price, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env};

    fn setup(env: &Env) -> (NavOracleContractClient<'_>, Address) {
        let contract_id = env.register(NavOracleContract, ());
        let client = NavOracleContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        client.initialize(&admin);
        (client, admin)
    }

    #[test]
    fn test_initialize_works() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        assert_eq!(client.get_admin(), admin);
        assert!(!client.has_price());
    }

    #[test]
    #[should_panic]
    fn test_double_initialize_panics() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.initialize(&admin);
    }

    #[test]
    fn test_update_and_get_price() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &100_000i128);
        assert!(client.has_price());
        assert_eq!(client.get_price(), 100_000i128);
    }

    #[test]
    fn test_price_update_replaces_old_price() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &100_000i128);
        client.update_price(&admin, &125_000i128);
        assert_eq!(client.get_price(), 125_000i128);
    }

    #[test]
    #[should_panic]
    fn test_get_price_without_set_panics() {
        let env = Env::default();
        let (client, _) = setup(&env);
        client.get_price();
    }

    #[test]
    fn test_clear_price() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &100_000i128);
        assert!(client.has_price());
        client.clear_price(&admin);
        assert!(!client.has_price());
    }

    #[test]
    #[should_panic]
    fn test_get_price_after_clear_panics() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &100_000i128);
        client.clear_price(&admin);
        client.get_price();
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_update_price() {
        let env = Env::default();
        let (client, _) = setup(&env);
        let non_admin = Address::generate(&env);
        client.update_price(&non_admin, &100_000i128);
    }

    #[test]
    #[should_panic]
    fn test_non_admin_cannot_clear_price() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &100_000i128);
        let non_admin = Address::generate(&env);
        client.clear_price(&non_admin);
    }

    #[test]
    #[should_panic]
    fn test_zero_price_rejected() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &0i128);
    }

    #[test]
    #[should_panic]
    fn test_negative_price_rejected() {
        let env = Env::default();
        let (client, admin) = setup(&env);
        client.update_price(&admin, &-1i128);
    }
}
