#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol};

const TTL_THRESHOLD: u32 = 100;
const TTL_EXTEND_TO: u32 = 3_110_400; // ~6 months at 5s/ledger

#[contract]
pub struct ApprovalControlContract;

#[contracttype]
enum DataKey {
    Admin,
    ApprovedUsers,
}

#[contractimpl]
impl ApprovalControlContract {
    pub fn initialize(env: Env, admin: Address) {
        let admin_already_set: bool = env.storage().persistent().has(&DataKey::Admin);
        if admin_already_set {
            panic!("contract already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin.clone());
        env.storage()
            .persistent()
            .set(&DataKey::ApprovedUsers, &Map::<Address, bool>::new(&env));
        Self::extend_ttl(&env);
        env.events().publish((symbol_short!("init"),), admin);
    }

    pub fn approve_user(env: Env, admin: Address, user: Address) {
        Self::require_admin(&env, &admin);
        let mut approved: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedUsers)
            .unwrap_or_else(|| Map::new(&env));
        approved.set(user.clone(), true);
        env.storage().persistent().set(&DataKey::ApprovedUsers, &approved);
        Self::extend_ttl(&env);
        env.events().publish((symbol_short!("apprv"),), (admin, user));
    }

    pub fn is_approved(env: Env, user: Address) -> bool {
        Self::extend_ttl(&env);
        let approved: Option<Map<Address, bool>> = env
            .storage()
            .persistent()
            .get(&DataKey::ApprovedUsers);
        approved
            .and_then(|map| map.get(user))
            .unwrap_or(false)
    }

    pub fn execute_action(env: Env, user: Address) -> Symbol {
        let approved = Self::is_approved(env.clone(), user.clone());
        if !approved {
            panic!("user is not approved to execute this action");
        }
        env.events().publish((symbol_short!("prot_exec"),), user);
        symbol_short!("exec")
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
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        if env.storage().persistent().has(&DataKey::Admin) {
            env.storage().persistent().extend_ttl(&DataKey::Admin, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        if env.storage().persistent().has(&DataKey::ApprovedUsers) {
            env.storage().persistent().extend_ttl(&DataKey::ApprovedUsers, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Env, Address, Symbol};

    fn sample_address(env: &Env, label: &str) -> Address {
        Address::from_contract_id(env, &Symbol::short(label))
    }

    #[test]
    fn test_initialize_works() {
        let env = Env::default();
        let admin = sample_address(&env, "ADMIN");
        ApprovalControlContract::initialize(env.clone(), admin.clone());
        assert!(!ApprovalControlContract::is_approved(env, admin));
    }

    #[test]
    #[should_panic(expected = "user is not approved to execute this action")]
    fn test_unapproved_user_cannot_execute() {
        let env = Env::default();
        let admin = sample_address(&env, "ADMIN");
        let user = sample_address(&env, "USER");
        ApprovalControlContract::initialize(env.clone(), admin.clone());
        ApprovalControlContract::execute_action(env, user);
    }

    #[test]
    fn test_admin_can_approve_user_and_user_can_execute() {
        let env = Env::default();
        let admin = sample_address(&env, "ADMIN");
        let user = sample_address(&env, "USER");
        ApprovalControlContract::initialize(env.clone(), admin.clone());
        ApprovalControlContract::approve_user(env.clone(), admin.clone(), user.clone());
        assert!(ApprovalControlContract::is_approved(env.clone(), user.clone()));
        let result = ApprovalControlContract::execute_action(env.clone(), user.clone());
        assert_eq!(result, Symbol::short("exec"));
    }
}
