
#[cfg(test)]
mod hermes_verify_cm_only_final2 {
    use super::auto_petrified_for;
    #[test]
    fn hermes_final2_cm_only() {
        assert!(auto_petrified_for("cerus", Some(true), Some(false), Some(8)));
        assert!(!auto_petrified_for("cerus", Some(true), Some(true), Some(0)));
        assert!(!auto_petrified_for("cerus", Some(false), Some(false), Some(2)));
        assert!(!auto_petrified_for("cerus", Some(true), Some(false), Some(11)));
    }
}
