/**
 * Skill ids that apply a control effect to foes.
 *
 * Generated from the official GW2 API tooltips (`GET /v2/skills?ids=all`):
 * each tooltip states the effect it applies, so the table is derived from
 * source data rather than typed by hand. Regenerate with
 * `scripts/refresh-cc-skills.py`, which filters out tooltips that only
 * describe a state ("dazed foes", "disables include ...").
 *
 * 168 skills.
 */
export type CcCategory = 'daze' | 'fear' | 'knockdown';

export const CC_SKILL_IDS: Record<string, CcCategory[]> = {
  1131: ["daze"], // Mace Head Crack
  1141: ["fear"], // Skull Fear
  1408: ["knockdown"], // Galloping Slash
  1644: ["knockdown"], // Smash
  1932: ["knockdown"], // Trample
  2013: ["knockdown"], // Axe
  3103: ["daze"], // Screech
  5490: ["daze"], // Comet
  5547: ["daze"], // Magnetic Surge
  5562: ["knockdown"], // Gale
  5690: ["knockdown"], // Earthquake
  5813: ["knockdown"], // Big Ol' Bomb
  5825: ["knockdown"], // Slick Shoes
  6057: ["daze"], // Throw Shield
  9093: ["knockdown"], // Bane Signet
  9125: ["knockdown"], // Hammer of Wisdom
  10169: ["daze"], // Chaos Storm
  10204: ["daze"], // Mantra of Distraction
  10206: ["daze"], // Power Lock
  10287: ["daze"], // Diversion
  10358: ["daze"], // Counter Blade
  10556: ["fear"], // Wail of Doom
  10588: ["fear"], // Doom
  10608: ["fear"], // Spectral Ring
  10641: ["fear"], // Death Curse
  10645: ["fear"], // Wave of Fear
  10647: ["knockdown"], // Charge
  10660: ["fear"], // Fear
  12318: ["daze"], // Technobabble
  12347: ["knockdown"], // Rocket Jump
  12408: ["daze"], // Shriek
  12425: ["fear"], // Snarl
  12475: ["daze"], // Hilt Bash
  12485: ["daze"], // Thunderclap
  12508: ["daze"], // Concussion Shot
  12621: ["daze"], // Call of the Wild
  12708: ["daze"], // Dazing Screech
  12709: ["daze"], // Dazing Screech
  12714: ["fear"], // Terrifying Howl
  13012: ["daze"], // Head Shot
  13024: ["daze"], // Choking Gas
  13114: ["daze"], // Tactical Strike
  14405: ["daze"], // Banner of Strength
  14409: ["fear"], // "Fear Me!"
  14415: ["knockdown"], // Tremor
  14490: ["knockdown"], // Seismic Leap
  14503: ["daze"], // Pommel Bash
  14511: ["knockdown"], // Backbreaker
  14515: ["knockdown"], // Hammer Toss
  14516: ["knockdown"], // Bull's Charge
  14572: ["daze"], // Banner of Strength
  16920: ["knockdown"], // Pound
  19115: ["fear"], // Reaper's Mark
  27356: ["knockdown"], // Energy Expulsion
  29114: ["knockdown"], // Energy Expulsion
  29679: ["daze"], // Skull Grinder
  29709: ["fear"], // Terrify
  29941: ["knockdown"], // Wild Blow
  29958: ["fear"], // Infusing Terror
  30262: ["daze"], // Flashbang
  30359: ["knockdown"], // Gravity Well
  30568: ["daze"], // Distracting Daggers
  30828: ["knockdown"], // Slick Shoes
  30871: ["daze"], // Light's Judgment
  30879: ["daze"], // Rupturing Smash
  31167: ["daze"], // Spare Capacitor
  31318: ["daze"], // Lunar Impact
  31658: ["daze"], // Glyph of Equality
  31746: ["daze"], // Glyph of Equality
  32364: ["daze"], // Lunar Impact
  37816: ["fear"], // Spear Impact
  37927: ["fear"], // Spear Impact
  38305: ["knockdown"], // Bludgeon
  40643: ["fear"], // Intimidating Shout
  41721: ["daze"], // Screech
  41820: ["knockdown"], // Scorchrazor
  42235: ["knockdown"], // Crystalline Impact
  42851: ["daze"], // Mirage Advance
  44360: ["fear"], // Fear
  44428: ["fear"], // Garish Pillar
  44937: ["daze"], // Disrupting Stab
  44998: ["daze"], // Polaric Leap
  45230: ["daze"], // Mirage Thrust
  46170: ["knockdown"], // Hammer of Wisdom
  46916: ["daze"], // Shield Bash
  47468: ["daze"], // Dwayna's Lightning
  47671: ["daze"], // Electric Bomb
  47824: ["daze"], // Sonic Blast
  47867: ["knockdown"], // Cascading Earth
  48106: ["daze"], // Shield Bash
  48339: ["daze"], // Righteous Lightning
  48489: ["daze"], // Dwayna's Lightning
  48662: ["fear"], // Howling Death
  48690: ["knockdown"], // Throw Boulder
  50472: ["knockdown"], // Slick Shoes
  50484: ["daze"], // Malicious Tactical Strike
  50491: ["knockdown"], // Slick Shoes
  50523: ["knockdown"], // Pulverizing Leap
  50594: ["daze"], // Lightning Storm
  50668: ["knockdown"], // Pulverizing Leap
  50828: ["daze"], // Disintegration Blast
  50984: ["knockdown"], // Pulverizing Leap
  51039: ["daze"], // Disintegration Blast
  51105: ["knockdown"], // Bloody Leap
  52173: ["knockdown"], // Pulverize
  52654: ["knockdown"], // Crystalline Impact
  53707: ["daze"], // Comet
  54133: ["daze"], // Bloody Bludgeon
  54413: ["daze"], // Disrupting Dagger
  54532: ["daze"], // Great Bludgeoning
  55040: ["knockdown"], // Hammer of Wisdom
  55053: ["knockdown"], // Hammer of Wisdom
  56873: ["daze"], // Time Sink
  56880: ["knockdown"], // Pitfall
  60132: ["knockdown"], // Charge!
  60369: ["knockdown"], // Body Slam
  61184: ["fear"], // Terrorstorm
  62539: ["daze"], // Voracious Arc
  62561: ["knockdown"], // Heaven's Palm
  62602: ["daze"], // Bladesong Dissonance
  62676: ["daze"], // Quick Retribution
  62947: ["knockdown"], // Wind Storm
  63075: ["daze"], // Overbearing Smash
  63220: ["fear"], // Dawn's Repose
  63227: ["fear"], // Dawn's Repose
  63230: ["daze"], // Well of Silence
  63330: ["knockdown"], // Thump
  63448: ["daze"], // Voracious Dive
  66258: ["daze"], // Heavy Shot
  66760: ["knockdown"], // Pulverize
  66896: ["knockdown"], // Heartpiercer
  69212: ["knockdown"], // Thump
  69262: ["daze"], // Overbearing Smash
  71688: ["daze"], // Ley Energy Pulse
  71802: ["daze"], // Helmet Breaker
  71841: ["daze"], // Wild Strikes
  71888: ["daze"], // Essence of Borrowed Time
  71966: ["daze"], // Dazing Discharge
  71998: ["fear"], // Devouring Visage
  72023: ["daze"], // Enervating Earth
  72927: ["daze"], // Distracting Throw
  73013: ["daze"], // Addle
  73019: ["daze"], // Harden
  73060: ["daze"], // Lesser Derecho
  73092: ["daze"], // Derecho
  73150: ["daze"], // Predator's Ambush
  75531: ["knockdown"], // Seismoelectricity
  75861: ["knockdown"], // Earthfall
  75899: ["daze"], // Charged Ground
  76500: ["daze"], // Flashbang
  76681: ["knockdown"], // Seismic Impact
  76707: ["knockdown"], // Seismic Impact
  76732: ["fear"], // Innervate Wanderlust
  76741: ["knockdown"], // Wanderlust
  76758: ["fear"], // Innervate Wanderlust
  76813: ["daze"], // Effulgent Stance
  76909: ["knockdown"], // Unstable Skritt Bomb
  76961: ["knockdown"], // Wanderlust
  76978: ["daze"], // Brilliant Slam
  77078: ["daze"], // Piercing Stance
  77339: ["daze"], // Dazzling Hammer
  78615: ["daze"], // Release Potential: Mesmer
  78873: ["daze"], // Piercing Shriek
  79486: ["knockdown"], // Claw Slam
  80760: ["knockdown"], // Worldpiercer
  80916: ["knockdown"], // Worldpiercer
  81369: ["knockdown"], // Archemorus's Strike
  81444: ["daze"], // Shock Wave
};
