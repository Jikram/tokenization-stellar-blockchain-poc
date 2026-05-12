#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Map, String};

const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO: u32 = 3_110_400; // ~6 months at 5s/ledger

#[contract]
pub struct ApprovalControlContract;

#[contracttype]
enum DataKey {
    Admin,
    ApprovedUsers,
    Balances,
}

#[contractimpl]
impl ApprovalControlContract {
    pub fn initialize(env: Env, admin: Address, asset_name: String) {
        let admin_already_set: bool = env.storage().persistent().has(&DataKey::Admin);
        if admin_already_set {
            panic!("contract already initialized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ApprovedUsers, &Map::<Address, bool>::new(&env));
        Self::extend_ttl(&env);
        // emits: Address (admin), String (asset name), u32 (deploy ledger)
        env.events().publish(
            (symbol_short!("init"),),
            (admin, asset_name, env.ledger().sequence()),
        );
    }

    pub fn approve_user(env: Env, admin: Address, user: Address) {
        Self::require_admin(&env, &admin);
        let mut approved: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedUsers)
            .unwrap_or_else(|| Map::new(&env));
        approved.set(user.clone(), true);
        env.storage()
            .persistent()
            .set(&DataKey::ApprovedUsers, &approved);
        Self::extend_ttl(&env);
        // emits: Address (admin), Address (user), bool (approved), u32 (ledger), u64 (unix timestamp)
        env.events().publish(
            (symbol_short!("apprv"),),
            (
                admin,
                user,
                true,
                env.ledger().sequence(),
                env.ledger().timestamp(),
            ),
        );
    }

    pub fn is_approved(env: Env, user: Address) -> bool {
        Self::extend_ttl(&env);
        let approved: Option<Map<Address, bool>> =
            env.storage().persistent().get(&DataKey::ApprovedUsers);
        approved.and_then(|map| map.get(user)).unwrap_or(false)
    }

    pub fn get_balance(env: Env, user: Address) -> u32 {
        Self::extend_ttl(&env);
        let balances: Option<Map<Address, u32>> =
            env.storage().persistent().get(&DataKey::Balances);
        balances.and_then(|map| map.get(user)).unwrap_or(0)
    }

    pub fn execute_action(env: Env, user: Address) -> u32 {
        let approved = Self::is_approved(env.clone(), user.clone());
        if !approved {
            panic!("user is not approved to execute this action");
        }
        let mut balances: Map<Address, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));
        let new_balance = balances.get(user.clone()).unwrap_or(0) + 1;
        balances.set(user.clone(), new_balance);
        env.storage()
            .persistent()
            .set(&DataKey::Balances, &balances);
        Self::extend_ttl(&env);
        // emits: Address (user), u32 (new balance), i128 (NAV price in cents), u64 (unix timestamp)
        env.events().publish(
            (symbol_short!("prot_exec"),),
            (user, new_balance, 100000i128, env.ledger().timestamp()),
        );
        new_balance
    }
}

impl ApprovalControlContract {
    fn require_admin(env: &Env, admin: &Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if &stored_admin != admin {
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
        if env.storage().persistent().has(&DataKey::ApprovedUsers) {
            env.storage().persistent().extend_ttl(
                &DataKey::ApprovedUsers,
                TTL_THRESHOLD,
                TTL_EXTEND_TO,
            );
        }
        if env.storage().persistent().has(&DataKey::Balances) {
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Balances, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    #[test]
    fn test_initialize_works() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        assert!(!client.is_approved(&admin));
    }

    #[test]
    #[should_panic]
    fn test_unapproved_user_cannot_execute() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.execute_action(&user);
    }

    #[test]
    fn test_admin_can_approve_user_and_user_can_execute() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        assert!(client.is_approved(&user));
        let balance = client.execute_action(&user);
        assert_eq!(balance, 1u32);
    }

    #[test]
    fn test_balance_increments_on_each_execute() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        assert_eq!(client.get_balance(&user), 0u32);
        assert_eq!(client.execute_action(&user), 1u32);
        assert_eq!(client.execute_action(&user), 2u32);
        assert_eq!(client.execute_action(&user), 3u32);
        assert_eq!(client.get_balance(&user), 3u32);
    }
}

// Invariant tests — verify rules that must hold true under all conditions
#[cfg(test)]
mod invariant_tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    // Invariant: once a user is approved they stay approved regardless of other operations
    #[test]
    fn invariant_approval_is_permanent() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Test Asset");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);

        // approve many other users — original approval must still hold
        for _ in 0..5 {
            let other = Address::generate(&env);
            client.approve_user(&admin, &other);
        }
        assert!(client.is_approved(&user));
    }

    // Invariant: non-admin can never approve anyone
    #[test]
    fn invariant_only_admin_can_approve() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Test Asset");
        client.initialize(&admin, &asset_name);

        let result = client.try_approve_user(&non_admin, &user);
        assert!(result.is_err());
        assert!(!client.is_approved(&user));
    }
}

// Fuzz tests — property-based tests with randomised inputs
#[cfg(test)]
mod fuzz_tests {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    proptest! {
        // Fuzz: is_approved never panics regardless of how many users are approved
        #[test]
        fn fuzz_is_approved_never_panics(n_approvals in 0usize..20) {
            let env = Env::default();
            let contract_id = env.register(ApprovalControlContract, ());
            let client = ApprovalControlContractClient::new(&env, &contract_id);
            let admin = Address::generate(&env);
            let asset_name = String::from_str(&env, "Fuzz Test Asset");
            client.initialize(&admin, &asset_name);

            // approve each user and immediately verify — avoids std::vec in no_std
            for _ in 0..n_approvals {
                let user = Address::generate(&env);
                client.approve_user(&admin, &user);
                prop_assert!(client.is_approved(&user));
            }

            // a fresh unapproved address must always return false
            let unknown = Address::generate(&env);
            prop_assert!(!client.is_approved(&unknown));
        }
    }
}
