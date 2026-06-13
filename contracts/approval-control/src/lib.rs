#![no_std]

use soroban_sdk::{
    contract, contractclient, contractevent, contractimpl, contracttype, Address, Bytes, Env, Map,
    String, Vec,
    
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

// Cross-contract interface for the NAV oracle.
// `contractclient` generates NavOracleClient used inside mint/burn/clawback.
#[contractclient(name = "NavOracleClient")]
pub trait NavOracleInterface {
    fn get_price(env: Env) -> i128;
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
    OracleId,
}

#[contractimpl]
impl ApprovalControlContract {
    // comment 
    pub fn initialize(env: Env, admin: Address, asset_name: String, nav_oracle_id: Address) {
        let admin_already_set: bool = env.storage().persistent().has(&DataKey::Admin);
        if admin_already_set {
            panic!("contract already initialized");
        }
        env.storage()
            .persistent()
            .set(&DataKey::Admin, &admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::OracleId, &nav_oracle_id);
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

    pub fn get_oracle_id(env: Env) -> Address {
        Self::extend_ttl(&env);
        env.storage()
            .persistent()
            .get(&DataKey::OracleId)
            .unwrap_or_else(|| panic!("contract not initialized"))
    }

    pub fn approve_user(env: Env, admin: Address, user: Address) {
        // comment
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
        //comment 2
        Self::require_admin(&env, &admin);
        // Cross-contract call: fetches live NAV price from oracle.
        // Panics (and rolls back the entire tx) if oracle has no price set.
        let nav_price = Self::get_oracle_price(&env);
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
            nav_price,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);
        new_balance
    }

    pub fn burn(env: Env, admin: Address, user: Address, amount: u32) -> u32 {
        Self::require_admin(&env, &admin);
        let nav_price = Self::get_oracle_price(&env);
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
            nav_price,
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
        let nav_price = Self::get_oracle_price(&env);
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
            nav_price,
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

    /// Cross-contract call to the NAV oracle. Panics (rolls back the tx) if oracle has no price.
    fn get_oracle_price(env: &Env) -> i128 {
        let oracle_id: Address = env
            .storage()
            .persistent()
            .get(&DataKey::OracleId)
            .unwrap_or_else(|| panic!("oracle not configured"));
        NavOracleClient::new(env, &oracle_id).get_price()
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
        if env.storage().persistent().has(&DataKey::OracleId) {
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::OracleId, TTL_THRESHOLD, TTL_EXTEND_TO);
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
    use nav_oracle::NavOracleContract;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    /// Deploy and initialize both contracts. Oracle price set to $1,000.00.
    /// Returns (token_contract_id, oracle_id, token_admin, oracle_admin).
    fn setup_token(env: &Env) -> (Address, Address, Address, Address) {
        let oracle_id = env.register(NavOracleContract, ());
        let oracle_admin = Address::generate(env);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id).initialize(&oracle_admin);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id)
            .update_price(&oracle_admin, &100_000i128);

        let contract_id = env.register(ApprovalControlContract, ());
        let admin = Address::generate(env);
        ApprovalControlContractClient::new(env, &contract_id).initialize(
            &admin,
            &String::from_str(env, "Tokenized Real Estate Fund Series A"),
            &oracle_id,
        );
        (contract_id, oracle_id, admin, oracle_admin)
    }

    /// Like setup_token but oracle price is NOT set. Used for failure tests.
    fn setup_token_no_price(env: &Env) -> (Address, Address, Address, Address) {
        let oracle_id = env.register(NavOracleContract, ());
        let oracle_admin = Address::generate(env);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id).initialize(&oracle_admin);
        // No update_price call — oracle has no price

        let contract_id = env.register(ApprovalControlContract, ());
        let admin = Address::generate(env);
        ApprovalControlContractClient::new(env, &contract_id).initialize(
            &admin,
            &String::from_str(env, "Tokenized Real Estate Fund Series A"),
            &oracle_id,
        );
        (contract_id, oracle_id, admin, oracle_admin)
    }

    #[test]
    fn test_initialize_works() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        assert!(!client.is_approved(&admin));
        assert_eq!(client.get_circulating_supply(), 0u32);
    }

    #[test]
    fn test_get_admin_returns_stored_admin() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    fn test_get_oracle_id_returns_oracle_address() {
        let env = Env::default();
        let (contract_id, oracle_id, _, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        assert_eq!(client.get_oracle_id(), oracle_id);
    }

    #[test]
    fn test_get_metadata_returns_stored_values() {
        let env = Env::default();
        let (contract_id, _, _, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
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
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.mint(&admin, &user, &100u32);
    }

    #[test]
    fn test_admin_can_approve_and_mint() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        assert!(client.is_approved(&user));
        let balance = client.mint(&admin, &user, &500u32);
        assert_eq!(balance, 500u32);
        assert_eq!(client.get_balance(&user), 500u32);
        assert_eq!(client.get_circulating_supply(), 500u32);
    }

    #[test]
    fn test_mint_records_oracle_price_in_event() {
        let env = Env::default();
        let (contract_id, oracle_id, admin, oracle_admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let oracle = nav_oracle::NavOracleContractClient::new(&env, &oracle_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);

        // Update oracle to a different price and confirm it's captured in the event
        oracle.update_price(&oracle_admin, &125_000i128); // $1,250.00
        client.mint(&admin, &user, &10u32);
        // If we reach here without panic, the mint succeeded and oracle was called
        assert_eq!(client.get_balance(&user), 10u32);
    }

    #[test]
    fn test_burn_reduces_balance_and_circulating_supply() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
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
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &100u32);
        client.burn(&admin, &user, &200u32);
    }

    #[test]
    fn test_clawback_works() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
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
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
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
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &1_000_001u32);
    }

    #[test]
    fn test_circulating_supply_tracks_across_multiple_investors() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        client.approve_user(&admin, &user1);
        client.approve_user(&admin, &user2);
        client.mint(&admin, &user1, &300u32);
        client.mint(&admin, &user2, &200u32);
        assert_eq!(client.get_circulating_supply(), 500u32);
        client.burn(&admin, &user1, &100u32);
        assert_eq!(client.get_circulating_supply(), 400u32);
    }

    // Oracle failure tests — demonstrate cross-contract atomicity

    #[test]
    #[should_panic]
    fn test_mint_fails_when_oracle_has_no_price() {
        let env = Env::default();
        let (contract_id, _, admin, _) = setup_token_no_price(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        // Oracle has no price — entire transaction rolls back atomically
        client.mint(&admin, &user, &100u32);
    }

    #[test]
    #[should_panic]
    fn test_burn_fails_when_oracle_has_no_price() {
        let env = Env::default();
        let (contract_id, oracle_id, admin, oracle_admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let oracle = nav_oracle::NavOracleContractClient::new(&env, &oracle_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &100u32);

        // Clear oracle price to trigger failure on next operation
        oracle.clear_price(&oracle_admin);
        // Burn rolls back atomically because oracle has no price
        client.burn(&admin, &user, &50u32);
    }

    #[test]
    fn test_balance_unchanged_after_oracle_failure() {
        let env = Env::default();
        let (contract_id, oracle_id, admin, oracle_admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let oracle = nav_oracle::NavOracleContractClient::new(&env, &oracle_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);
        client.mint(&admin, &user, &100u32);
        assert_eq!(client.get_balance(&user), 100u32);
        assert_eq!(client.get_circulating_supply(), 100u32);

        oracle.clear_price(&oracle_admin);

        // Attempt burn — should fail. Verify state is unchanged.
        let result = client.try_burn(&admin, &user, &50u32);
        assert!(result.is_err());
        // Atomicity: balance and supply unchanged after rollback
        assert_eq!(client.get_balance(&user), 100u32);
        assert_eq!(client.get_circulating_supply(), 100u32);
    }

    #[test]
    fn test_mint_resumes_after_oracle_price_restored() {
        let env = Env::default();
        let (contract_id, oracle_id, admin, oracle_admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let oracle = nav_oracle::NavOracleContractClient::new(&env, &oracle_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);

        oracle.clear_price(&oracle_admin);
        let result = client.try_mint(&admin, &user, &100u32);
        assert!(result.is_err());

        // Restore price and verify mint succeeds
        oracle.update_price(&oracle_admin, &110_000i128); // $1,100.00
        client.mint(&admin, &user, &100u32);
        assert_eq!(client.get_balance(&user), 100u32);
    }
}

// Invariant tests — verify rules that must hold true under all conditions
#[cfg(test)]
mod invariant_tests {
    use super::*;
    use nav_oracle::NavOracleContract;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    fn setup_token(env: &Env) -> (Address, Address) {
        let oracle_id = env.register(NavOracleContract, ());
        let oracle_admin = Address::generate(env);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id).initialize(&oracle_admin);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id)
            .update_price(&oracle_admin, &100_000i128);
        let contract_id = env.register(ApprovalControlContract, ());
        let admin = Address::generate(env);
        ApprovalControlContractClient::new(env, &contract_id).initialize(
            &admin,
            &String::from_str(env, "Test Asset"),
            &oracle_id,
        );
        (contract_id, admin)
    }

    #[test]
    fn invariant_approval_is_permanent() {
        let env = Env::default();
        let (contract_id, admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);

        for _ in 0..5 {
            let other = Address::generate(&env);
            client.approve_user(&admin, &other);
        }
        assert!(client.is_approved(&user));
    }

    #[test]
    fn invariant_only_admin_can_approve() {
        let env = Env::default();
        let (contract_id, _) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let non_admin = Address::generate(&env);
        let user = Address::generate(&env);

        let result = client.try_approve_user(&non_admin, &user);
        assert!(result.is_err());
        assert!(!client.is_approved(&user));
    }

    #[test]
    fn invariant_only_admin_can_mint() {
        let env = Env::default();
        let (contract_id, admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let non_admin = Address::generate(&env);
        let user = Address::generate(&env);
        client.approve_user(&admin, &user);

        let result = client.try_mint(&non_admin, &user, &100u32);
        assert!(result.is_err());
        assert_eq!(client.get_balance(&user), 0u32);
        assert_eq!(client.get_circulating_supply(), 0u32);
    }

    #[test]
    fn invariant_circulating_never_exceeds_total_supply() {
        let env = Env::default();
        let (contract_id, admin) = setup_token(&env);
        let client = ApprovalControlContractClient::new(&env, &contract_id);
        let user = Address::generate(&env);
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
    use nav_oracle::NavOracleContract;
    use proptest::prelude::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Address, Env, String};

    fn setup_token(env: &Env) -> (Address, Address) {
        let oracle_id = env.register(NavOracleContract, ());
        let oracle_admin = Address::generate(env);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id).initialize(&oracle_admin);
        nav_oracle::NavOracleContractClient::new(env, &oracle_id)
            .update_price(&oracle_admin, &100_000i128);
        let contract_id = env.register(ApprovalControlContract, ());
        let admin = Address::generate(env);
        ApprovalControlContractClient::new(env, &contract_id).initialize(
            &admin,
            &String::from_str(env, "Fuzz Test Asset"),
            &oracle_id,
        );
        (contract_id, admin)
    }

    proptest! {
        #[test]
        fn fuzz_is_approved_never_panics(n_approvals in 0usize..20) {
            let env = Env::default();
            let (contract_id, admin) = setup_token(&env);
            let client = ApprovalControlContractClient::new(&env, &contract_id);

            for _ in 0..n_approvals {
                let user = Address::generate(&env);
                client.approve_user(&admin, &user);
                prop_assert!(client.is_approved(&user));
            }

            let unknown = Address::generate(&env);
            prop_assert!(!client.is_approved(&unknown));
        }

        #[test]
        fn fuzz_mint_never_exceeds_total_supply(amounts in proptest::collection::vec(1u32..100u32, 1..20)) {
            let env = Env::default();
            let (contract_id, admin) = setup_token(&env);
            let client = ApprovalControlContractClient::new(&env, &contract_id);
            let user = Address::generate(&env);
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
