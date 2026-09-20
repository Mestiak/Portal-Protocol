const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const professionsDir = path.join(__dirname, '../src/lib/assets/professions');
const bossesDir = path.join(__dirname, '../src/lib/assets/bosses');

fs.mkdirSync(professionsDir, { recursive: true });
fs.mkdirSync(bossesDir, { recursive: true });

// Custom downloader supporting HTTP redirects (301, 302) and custom User-Agent
const downloadWithRedirects = (url, dest) => {
  return new Promise((resolve, reject) => {
    const request = (targetUrl) => {
      const parsedUrl = new URL(targetUrl);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };

      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      protocol.get(options, (response) => {
        // Handle redirect status codes
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          let redirectUrl = response.headers.location;
          // Resolve relative redirect paths
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = new URL(redirectUrl, targetUrl).href;
          }
          request(redirectUrl);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Status Code: ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close(resolve);
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    };

    request(url);
  });
};

const professions = {
  // Base classes
  'guardian': 'https://wiki.guildwars2.com/images/6/6c/Guardian_tango_icon_200px.png',
  'warrior': 'https://wiki.guildwars2.com/images/3/3c/Warrior_tango_icon_200px.png',
  'engineer': 'https://wiki.guildwars2.com/images/2/2f/Engineer_tango_icon_200px.png',
  'ranger': 'https://wiki.guildwars2.com/images/5/51/Ranger_tango_icon_200px.png',
  'thief': 'https://wiki.guildwars2.com/images/1/19/Thief_tango_icon_200px.png',
  'elementalist': 'https://wiki.guildwars2.com/images/a/a0/Elementalist_tango_icon_200px.png',
  'mesmer': 'https://wiki.guildwars2.com/images/b/b2/Mesmer_tango_icon_200px.png',
  'necromancer': 'https://wiki.guildwars2.com/images/c/cd/Necromancer_tango_icon_200px.png',
  'revenant': 'https://wiki.guildwars2.com/images/b/b5/Revenant_tango_icon_200px.png',

  // Elite Specs
  'druid': 'https://wiki.guildwars2.com/images/d/d2/Druid_icon.png',
  'daredevil': 'https://wiki.guildwars2.com/images/c/ca/Daredevil_icon.png',
  'berserker': 'https://wiki.guildwars2.com/images/8/80/Berserker_icon.png',
  'dragonhunter': 'https://wiki.guildwars2.com/images/c/c9/Dragonhunter_icon.png',
  'scrapper': 'https://wiki.guildwars2.com/images/3/3a/Scrapper_icon.png',
  'reaper': 'https://wiki.guildwars2.com/images/1/11/Reaper_icon.png',
  'chronomancer': 'https://wiki.guildwars2.com/images/f/f4/Chronomancer_icon.png',
  'holosmith': 'https://wiki.guildwars2.com/images/a/ae/Holosmith_icon.png',
  'tempest': 'https://wiki.guildwars2.com/images/e/ef/Tempest_icon.png',
  'herald': 'https://wiki.guildwars2.com/images/c/c1/Herald_icon.png',
  'soulbeast': 'https://wiki.guildwars2.com/images/f/f6/Soulbeast_icon.png',
  'weaver': 'https://wiki.guildwars2.com/images/f/fc/Weaver_icon.png',
  'renegade': 'https://wiki.guildwars2.com/images/b/bc/Renegade_icon.png',
  'deadeye': 'https://wiki.guildwars2.com/images/b/b0/Deadeye_icon.png',
  'mirage': 'https://wiki.guildwars2.com/images/a/a9/Mirage_icon.png',
  'scourge': 'https://wiki.guildwars2.com/images/e/e4/Scourge_icon.png',
  'spellbreaker': 'https://wiki.guildwars2.com/images/7/78/Spellbreaker_icon.png',
  'firebrand': 'https://wiki.guildwars2.com/images/d/d1/Firebrand_icon.png',
  'harbinger': 'https://wiki.guildwars2.com/images/f/fb/Harbinger_icon.png',
  'willbender': 'https://wiki.guildwars2.com/images/4/47/Willbender_icon.png',
  'virtuoso': 'https://wiki.guildwars2.com/images/b/b9/Virtuoso_icon.png',
  'catalyst': 'https://wiki.guildwars2.com/images/a/a3/Catalyst_icon.png',
  'bladesworn': 'https://wiki.guildwars2.com/images/c/c1/Bladesworn_icon.png',
  'vindicator': 'https://wiki.guildwars2.com/images/e/e7/Vindicator_icon.png',
  'mechanist': 'https://wiki.guildwars2.com/images/3/31/Mechanist_icon.png',
  'specter': 'https://wiki.guildwars2.com/images/e/eb/Specter_icon.png',
  'untamed': 'https://wiki.guildwars2.com/images/3/37/Untamed_icon.png'
};

const bosses = {
  'cerus': 'https://wiki.guildwars2.com/images/f/fd/Mini_Cerus.png',
  'standardkittygolem': 'https://wiki.guildwars2.com/images/8/8f/Mini_Professor_Meow.png',
  'ankka': 'https://wiki.guildwars2.com/images/6/6f/Mini_Ankka.png',
  'dagda': 'https://wiki.guildwars2.com/images/d/df/Mini_Dagda.png',
  'kanaxai': 'https://wiki.guildwars2.com/images/7/77/Mini_Kanaxai.png',
  'valeguardian': 'https://wiki.guildwars2.com/images/f/fb/Mini_Vale_Guardian.png',
  'gorsevalthemultifarious': 'https://wiki.guildwars2.com/images/d/d1/Mini_Gorseval_the_Multifarious.png',
  'sabethathesaboteur': 'https://wiki.guildwars2.com/images/5/5e/Mini_Sabetha.png',
  'slothasor': 'https://wiki.guildwars2.com/images/1/12/Mini_Slothasor.png',
  'matthiasgabrel': 'https://wiki.guildwars2.com/images/5/5d/Mini_Matthias_Gabrel.png',
  'keepconstruct': 'https://wiki.guildwars2.com/images/e/ea/Mini_Keep_Construct.png',
  'xera': 'https://wiki.guildwars2.com/images/4/4b/Mini_Xera.png',
  'cairntheindomitable': 'https://wiki.guildwars2.com/images/b/b8/Mini_Cairn_the_Indomitable.png',
  'mursaatoverseer': 'https://wiki.guildwars2.com/images/c/c8/Mini_Mursaat_Overseer.png',
  'samarog': 'https://wiki.guildwars2.com/images/2/2f/Mini_Samarog.png',
  'deimos': 'https://wiki.guildwars2.com/images/e/e0/Mini_Deimos.png',
  'soullesshorror': 'https://wiki.guildwars2.com/images/d/d4/Mini_Soulless_Horror.png',
  'dhuum': 'https://wiki.guildwars2.com/images/c/c8/Mini_Dhuum.png',
  'conjuredamalgamate': 'https://wiki.guildwars2.com/images/e/ec/Mini_Conjured_Amalgamate.png',
  'largostwins': 'https://wiki.guildwars2.com/images/e/ea/Mini_Kenut.png',
  'qadim': 'https://wiki.guildwars2.com/images/f/f2/Mini_Qadim.png',
  'cardinalsabir': 'https://wiki.guildwars2.com/images/f/fc/Mini_Cardinal_Sabir.png',
  'cardinaladina': 'https://wiki.guildwars2.com/images/a/a0/Mini_Cardinal_Adina.png',
  'qadimthepeerless': 'https://wiki.guildwars2.com/images/8/85/Mini_Qadim_the_Peerless.png',
  'unknown': 'https://wiki.guildwars2.com/images/d/d2/Mini_Angry_Chest.png'
};

async function run() {
  console.log('Downloading profession and spec icons supporting redirects...');
  for (const [name, url] of Object.entries(professions)) {
    const dest = path.join(professionsDir, `${name}.png`);
    try {
      await downloadWithRedirects(url, dest);
      console.log(`✓ Downloaded ${name}.png`);
    } catch (err) {
      console.error(`✗ Failed to download ${name}: ${err.message}`);
    }
  }

  console.log('Downloading boss icons supporting redirects...');
  for (const [name, url] of Object.entries(bosses)) {
    const dest = path.join(bossesDir, `${name}.png`);
    try {
      await downloadWithRedirects(url, dest);
      console.log(`✓ Downloaded boss: ${name}.png`);
    } catch (err) {
      console.error(`✗ Failed to download boss ${name}: ${err.message}`);
    }
  }
  console.log('All downloads complete!');
}

run();
