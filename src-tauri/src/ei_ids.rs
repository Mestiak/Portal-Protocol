//! Authoritative IDs mirrored from Elite Insights 3.32.0.0.
//!
//! Source of truth: `C:\Users\Usuario\Desktop\GW2-Elite-Insights-Parser-3.32.0.0`
//! - `LogIDs.md` / `ParserHelpers/IDs/LogIDs.cs` → [`LOG_ID_NAMES`]
//! - `ParserHelpers/IDs/SpeciesIDs.cs` → [`CM_SPECIES_IDS`]
//! - `ParserHelpers/IDs/SkillIDs.cs` → buff constants
//!
//! Keep this module in sync when the bundled EI is updated.

/// (log id, display name) pairs from EI's `LogIDs.md` (hex ids, decimal here).
/// Used to resolve the `EILogID` field of an EI JSON parse.
pub const LOG_ID_NAMES: &[(u32, &str)] = &[
    (65536, "Unsupported"),
    (131328, "Spirit Vale Full Instance"),
    (131329, "Vale Guardian"),
    (131330, "Gorseval"),
    (131331, "Sabetha"),
    (131332, "SpiritRace"),
    (131584, "Salvation Pass Full Instance"),
    (131585, "Slothasor"),
    (131586, "Bandit Trio"),
    (131587, "Matthias"),
    (131840, "Stronghold of the Faithful Full Instance"),
    (131841, "Escort"),
    (131842, "Keep Construct"),
    (131843, "Twisted Castle"),
    (131844, "Xera"),
    (132096, "Bastion of the Penitent Full Instance"),
    (132097, "Cairn"),
    (132098, "Mursaat Overseer"),
    (132099, "Samarog"),
    (132100, "Deimos"),
    (132352, "Hall of Chains Full Instance"),
    (132353, "Soulless Horror"),
    (132354, "River of Souls"),
    (132355, "Broken King"),
    (132356, "Soul Eater"),
    (132357, "Eye of Judgement/Eye of Fate"),
    (132358, "Dhuum"),
    (132608, "Mythwright Gambit Full Instance"),
    (132609, "Conjured Amalgamate"),
    (132610, "Twin Largos"),
    (132611, "Qadim"),
    (132864, "The Key of Ahdashim Full Instance"),
    (132865, "Adina"),
    (132866, "Sabir"),
    (132867, "Qadim the Peerless"),
    (133120, "Mount Balrior Full Instance"),
    (133121, "Greer, the Blightbringer"),
    (133122, "Decima, the Stormsinger"),
    (133123, "Ura, the Steamshrieker"),
    (196864, "Nightmare Full Instance"),
    (196865, "MAMA"),
    (196866, "Siax"),
    (196867, "Ensolyss"),
    (197120, "Shattered Observatory Full Instance"),
    (197121, "Skorvald"),
    (197122, "Artsariiv"),
    (197123, "Arkk"),
    (197376, "Sunqua Peak Full Instance"),
    (197377, "Ai, Elemental and Dark"),
    (197378, "Ai, Elemental Only"),
    (197379, "Ai, Dark Only"),
    (197632, "Slient Surf Full Instance"),
    (197633, "Kanaxai, Scythe of House Aurkus"),
    (197888, "Lonely Tower Full Instance"),
    (197889, "Cerus and Deimos"),
    (197890, "Eparch"),
    (198144, "Kinfall Full Instance"),
    (198145, "Whispering Shadow"),
    (198400, "Solitary Throne Full Instance"),
    (198401, "The Eternal Tyrant"),
    (262401, "Freezie"),
    (262657, "Icebrood Construct"),
    (262658, "Fraenir of Jormag"),
    (262659, "Voice&Claw"),
    (262660, "Boneskinner"),
    (262661, "Whisper of Jormag"),
    (262662, "Varinia Stormsounder"),
    (262913, "Aetherblade Hideout"),
    (262914, "Xunlai Jade Junkyard"),
    (262915, "Kaineng Overlook"),
    (262916, "Harvest Temple"),
    (262917, "Old Lion's Court"),
    (263425, "Cosmic Observatory"),
    (263426, "Temple of Febe"),
    (263681, "Guardian's Glade"),
    (263682, "Nexus of Eternity"),
    (328705, "Soo-Won"),
    (393729, "Mordremoth"),
    (459008, "Eternal Battlegrounds"),
    (459264, "Green Alpine Borderlands"),
    (459520, "Blue Alpine Borderlands"),
    (459776, "Red Desert Borderlands"),
    (460032, "Obsidian Sanctum"),
    (460288, "Edge of the Mists"),
    (460544, "Armistice Bastion"),
    (460800, "Gilded Hollow"),
    (461056, "Lost Precipice"),
    (461312, "Windswept Haven"),
    (461568, "Isle of Reflection"),
    (524545, "Massive Golem 10M"),
    (524546, "Massive Golem 4M"),
    (524547, "Massive Golem 1M"),
    (524548, "Vital Golem"),
    (524549, "Average Golem"),
    (524550, "Standard Golem"),
    (524551, "Condition Golem"),
    (524552, "Power Golem"),
    (524553, "Large Golem"),
    (524554, "Medium Golem"),
    (590081, "Demon Knight"),
    (590082, "Sorrow"),
    (590083, "Dreadwing"),
    (590084, "Hell Sister"),
    (590085, "Umbriel"),
    (590337, "Greer, the Blightbringer"),
    (590338, "Decima, the Stormsinger"),
    (590339, "Ura, the Steamshrieker"),
    (590592, "Vloxx"),
];

/// Resolve an EI `EILogID` to its display name.
pub fn log_id_name(id: u32) -> Option<&'static str> {
    LOG_ID_NAMES
        .iter()
        .find(|(i, _)| *i == id)
        .map(|(_, n)| *n)
}

/// Species IDs that have a distinct Challenge Mode variant (from SpeciesIDs.cs).
/// Used to disambiguate CM/normal targets by species rather than by name.
/// Note: Greer CM is detected by the `Ereg` add (26859), Ura CM by HP threshold —
/// neither has a distinct CM species id.
pub const CM_SPECIES_IDS: &[(u32, &str)] = &[(26867, "DecimaCM")];

/// True when the species id is a known CM variant.
pub fn is_cm_species(id: u32) -> bool {
    CM_SPECIES_IDS.iter().any(|(i, _)| *i == id)
}

/// Quick Play instance buffs (SkillIDs.cs: QuickplayBoost / QuickplayMorale).
pub const QUICK_PLAY_BUFF_IDS: &[u32] = &[77676, 79492];

/// Ura "After Health Regeneration" buff (SkillIDs.cs: Determined895).
/// AHR itself is detected from EI phase names ("Healed" / "100% - 1%"); this
/// constant documents the buff that creates those phases.
#[allow(dead_code)]
pub const URA_AHR_BUFF_ID: u32 = 895;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_id_name_resolves_known_ids() {
        assert_eq!(log_id_name(131329), Some("Vale Guardian"));
        assert_eq!(log_id_name(263682), Some("Nexus of Eternity"));
        assert_eq!(log_id_name(590592), Some("Vloxx"));
        assert_eq!(log_id_name(0), None);
    }

    #[test]
    fn cm_species_detection() {
        assert!(is_cm_species(26867)); // DecimaCM
        assert!(!is_cm_species(26774)); // Decima (normal)
        assert!(!is_cm_species(26725)); // Greer (normal)
    }
}
