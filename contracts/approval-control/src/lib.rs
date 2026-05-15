#![no_std]

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Bytes, Env, Map, String, Vec,
};

#[contracttype]
pub enum AssetStatus {
    Active,
    Suspended,
    Redeemed,
}

#[contracttype]
pub struct GeoLocation {
    pub country: String,
    pub region: String,
}

#[contracttype]
pub struct AssetMetadata {
    pub asset_type: String,
    pub document_hash: Bytes,
    pub geo: GeoLocation,
    pub issued_at: u64,
    pub min_investment: u128,
    pub optional_isin: Option<String>,
    pub properties: Map<String, String>,
    pub status: AssetStatus,
    pub tags: Vec<String>,
    pub total_supply: u128,
}

#[contractevent]
pub struct Init {
    pub admin: Address,
    pub asset_name: String,
    pub ledger: u32,
    pub metadata: AssetMetadata,
}

#[contractevent]
pub struct Approved {
    pub admin: Address,
    pub user: Address,
    pub approved: bool,
    pub ledger: u32,
    pub timestamp: u64,
}

#[contractevent]
pub struct Minted {
    pub admin: Address,
    pub user: Address,
    pub amount: u32,
    pub new_balance: u32,
    pub circulating_supply: u32,
    pub nav_price: i128,
    pub timestamp: u64,
}

#[contractevent]
pub struct Burned {
    pub admin: Address,
    pub user: Address,
    pub amount: u32,
    pub new_balance: u32,
    pub circulating_supply: u32,
    pub nav_price: i128,
    pub timestamp: u64,
}

#[contractevent]
pub struct Clawback {
    pub admin: Address,
    pub user: Address,
    pub amount: u32,
    pub new_balance: u32,
    pub circulating_supply: u32,
    pub nav_price: i128,
    pub reason: String,
    pub severity: i32,
    pub case_reference: i64,
    pub timestamp: u64,
}

const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO: u32 = 3_110_400; // ~6 months at 5s/ledger

#[contract]
pub struct ApprovalControlContract;

#[contracttype]
enum DataKey {
    Admin,
    ApprovedUsers,
    Balances,
    Metadata,
    CirculatingSupply,
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
        env.storage()
            .persistent()
            .set(&DataKey::CirculatingSupply, &0u32);
        Self::extend_ttl(&env);

        let mut tags: Vec<String> = Vec::new(&env);
        tags.push_back(String::from_str(&env, "real-estate"));
        tags.push_back(String::from_str(&env, "series-a"));
        tags.push_back(String::from_str(&env, "kyc-gated"));
        tags.push_back(String::from_str(&env, "testnet"));

        let mut properties: Map<String, String> = Map::new(&env);
        properties.set(
            String::from_str(&env, "risk_level"),
            String::from_str(&env, "medium"),
        );
        properties.set(
            String::from_str(&env, "liquidity"),
            String::from_str(&env, "low"),
        );
        properties.set(
            String::from_str(&env, "fund_manager"),
            String::from_str(&env, "Jamshaid"),
        );

        let metadata = AssetMetadata {
            asset_type: String::from_str(&env, "real-estate"),
            document_hash: Bytes::from_slice(
                &env,
                &[
                    0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe, 0x01, 0x23, 0x45, 0x67, 0x89,
                    0xab, 0xcd, 0xef,
                ],
            ),
            geo: GeoLocation {
                country: String::from_str(&env, "TX"),
                region: String::from_str(&env, "Dallas"),
            },
            issued_at: env.ledger().timestamp(),
            min_investment: 1_000u128,
            optional_isin: Some(String::from_str(&env, "US0231351067")),
            properties,
            status: AssetStatus::Active,
            tags,
            total_supply: 1_000_000u128,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Metadata, &metadata);
        Self::extend_ttl(&env);

        Init {
            admin,
            asset_name,
            ledger: env.ledger().sequence(),
            metadata,
        }
        .publish(&env);
    }

    pub fn get_admin(env: Env) -> Address {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    pub fn get_metadata(env: Env) -> AssetMetadata {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Metadata)
            .unwrap_or_else(|| panic!("contract not initialized"))
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
        Approved {
            admin,
            user,
            approved: true,
            ledger: env.ledger().sequence(),
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
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

    pub fn get_circulating_supply(env: Env) -> u32 {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::CirculatingSupply)
            .unwrap_or(0)
    }

    pub fn mint(env: Env, admin: Address, user: Address, amount: u32) -> u32 {
        Self::require_admin(&env, &admin);
        let approved = Self::is_approved(env.clone(), user.clone());
        if !approved {
            panic!("user is not approved to receive tokens");
        }
        let circulating: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CirculatingSupply)
            .unwrap_or(0);
        let metadata: AssetMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Metadata)
            .unwrap_or_else(|| panic!("contract not initialized"));
        if (circulating as u128) + (amount as u128) > metadata.total_supply {
            panic!("mint exceeds total supply cap");
        }
        let mut balances: Map<Address, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));
        let new_balance = balances.get(user.clone()).unwrap_or(0) + amount;
        balances.set(user.clone(), new_balance);
        env.storage()
            .persistent()
            .set(&DataKey::Balances, &balances);
        let new_circulating = circulating + amount;
        env.storage()
            .persistent()
            .set(&DataKey::CirculatingSupply, &new_circulating);
        Self::extend_ttl(&env);
        Minted {
            admin,
            user,
            amount,
            new_balance,
            circulating_supply: new_circulating,
            nav_price: 100_000i128,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        new_balance
    }

    pub fn burn(env: Env, admin: Address, user: Address, amount: u32) -> u32 {
        Self::require_admin(&env, &admin);
        let mut balances: Map<Address, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));
        let current = balances.get(user.clone()).unwrap_or(0);
        if amount > current {
            panic!("cannot burn more than current balance");
        }
        let new_balance = current - amount;
        balances.set(user.clone(), new_balance);
        env.storage()
            .persistent()
            .set(&DataKey::Balances, &balances);
        let circulating: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CirculatingSupply)
            .unwrap_or(0);
        let new_circulating = circulating - amount;
        env.storage()
            .persistent()
            .set(&DataKey::CirculatingSupply, &new_circulating);
        Self::extend_ttl(&env);
        Burned {
            admin,
            user,
            amount,
            new_balance,
            circulating_supply: new_circulating,
            nav_price: 100_000i128,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        new_balance
    }

    pub fn clawback(
        env: Env,
        admin: Address,
        user: Address,
        amount: u32,
        reason: String,
        severity: i32,
        case_reference: i64,
    ) -> u32 {
        Self::require_admin(&env, &admin);
        let mut balances: Map<Address, u32> = env
            .storage()
            .persistent()
            .get(&DataKey::Balances)
            .unwrap_or_else(|| Map::new(&env));
        let current = balances.get(user.clone()).unwrap_or(0);
        if amount > current {
            panic!("cannot clawback more than current balance");
        }
        let new_balance = current - amount;
        balances.set(user.clone(), new_balance);
        env.storage()
            .persistent()
            .set(&DataKey::Balances, &balances);
        let circulating: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CirculatingSupply)
            .unwrap_or(0);
        let new_circulating = circulating - amount;
        env.storage()
            .persistent()
            .set(&DataKey::CirculatingSupply, &new_circulating);
        Self::extend_ttl(&env);
        Clawback {
            admin,
            user,
            amount,
            new_balance,
            circulating_supply: new_circulating,
            nav_price: 100_000i128,
            reason,
            severity,
            case_reference,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
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
        if env.storage().persistent().has(&DataKey::Metadata) {
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Metadata, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        if env.storage().persistent().has(&DataKey::CirculatingSupply) {
            env.storage().persistent().extend_ttl(
                &DataKey::CirculatingSupply,
                TTL_THRESHOLD,
                TTL_EXTEND_TO,
            );
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
        assert_eq!(client.get_circulating_supply(), 0u32);
    }

    #[test]
    fn test_get_admin_returns_stored_admin() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_get_metadata_returns_stored_values() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        let meta = client.get_metadata();
        assert_eq!(meta.asset_type, String::from_str(&env, "real-estate"));
        assert_eq!(meta.total_supply, 1_000_000u128);
        assert_eq!(meta.min_investment, 1_000u128);
        assert_eq!(meta.geo.region, String::from_str(&env, "Dallas"));
        assert_eq!(meta.geo.country, String::from_str(&env, "TX"));
    }

    #[test]
    #[should_panic]
    fn test_unapproved_user_cannot_mint() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.mint(&admin, &user, &100u32);
    }

    #[test]
    fn test_admin_can_approve_and_mint() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        assert!(client.is_approved(&user));
        let balance = client.mint(&admin, &user, &500u32);
        assert_eq!(balance, 500u32);
        assert_eq!(client.get_balance(&user), 500u32);
        assert_eq!(client.get_circulating_supply(), 500u32);
    }

    #[test]
    fn test_burn_reduces_balance_and_circulating_supply() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &500u32);
        let new_balance = client.burn(&admin, &user, &200u32);
        assert_eq!(new_balance, 300u32);
        assert_eq!(client.get_balance(&user), 300u32);
        assert_eq!(client.get_circulating_supply(), 300u32);
    }

    #[test]
    #[should_panic]
    fn test_cannot_burn_more_than_balance() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &100u32);
        client.burn(&admin, &user, &200u32);
    }

    #[test]
    fn test_clawback_works() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &500u32);
        let new_balance = client.clawback(
            &admin,
            &user,
            &100u32,
            &String::from_str(&env, "sanctions"),
            &9i32,
            &20260515001i64,
        );
        assert_eq!(new_balance, 400u32);
        assert_eq!(client.get_balance(&user), 400u32);
        assert_eq!(client.get_circulating_supply(), 400u32);
    }

    #[test]
    #[should_panic]
    fn test_cannot_clawback_more_than_balance() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &100u32);
        client.clawback(
            &admin,
            &user,
            &200u32,
            &String::from_str(&env, "fraud"),
            &5i32,
            &20260515002i64,
        );
    }

    #[test]
    #[should_panic]
    fn test_cannot_mint_beyond_total_supply() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &1_000_001u32);
    }

    #[test]
    fn test_circulating_supply_tracks_across_multiple_investors() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        let asset_name = String::from_str(&env, "Tokenized Real Estate Fund Series A");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user1);
        client.approve_user(&admin, &user2);
        client.mint(&admin, &user1, &300u32);
        client.mint(&admin, &user2, &200u32);
        assert_eq!(client.get_circulating_supply(), 500u32);
        client.burn(&admin, &user1, &100u32);
        assert_eq!(client.get_circulating_supply(), 400u32);
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

    // Invariant: non-admin can never mint tokens
    #[test]
    fn invariant_only_admin_can_mint() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Test Asset");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);

        let result = client.try_mint(&non_admin, &user, &100u32);
        assert!(result.is_err());
        assert_eq!(client.get_balance(&user), 0u32);
        assert_eq!(client.get_circulating_supply(), 0u32);
    }

    // Invariant: circulating supply never exceeds total supply cap
    #[test]
    fn invariant_circulating_never_exceeds_total_supply() {
        let env = Env::default();
        let contract_id = env.register(ApprovalControlContract, ());
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let asset_name = String::from_str(&env, "Test Asset");
        client.initialize(&admin, &asset_name);
        client.approve_user(&admin, &user);

        client.mint(&admin, &user, &999_999u32);
        assert_eq!(client.get_circulating_supply(), 999_999u32);
        client.mint(&admin, &user, &1u32);
        assert_eq!(client.get_circulating_supply(), 1_000_000u32);
        let result = client.try_mint(&admin, &user, &1u32);
        assert!(result.is_err());
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

            // approve each user and immediately verify
            for _ in 0..n_approvals {
                let user = Address::generate(&env);
                client.approve_user(&admin, &user);
                prop_assert!(client.is_approved(&user));
            }

            // a fresh unapproved address must always return false
            let unknown = Address::generate(&env);
            prop_assert!(!client.is_approved(&unknown));
        }

        // Fuzz: circulating supply never exceeds total supply under random mint amounts
        #[test]
        fn fuzz_mint_never_exceeds_total_supply(amounts in proptest::collection::vec(1u32..100u32, 1..20)) {
            let env = Env::default();
            let contract_id = env.register(ApprovalControlContract, ());
            let client = ApprovalControlContractClient::new(&env, &contract_id);
            let admin = Address::generate(&env);
            let user = Address::generate(&env);
            let asset_name = String::from_str(&env, "Fuzz Test Asset");
            client.initialize(&admin, &asset_name);
            client.approve_user(&admin, &user);

            let mut total_minted: u32 = 0;
            for amount in &amounts {
                if total_minted + amount <= 1_000_000u32 {
                    client.mint(&admin, &user, amount);
                    total_minted += amount;
                    prop_assert!(client.get_circulating_supply() <= 1_000_000u32);
                }
            }
        }
    }
}
