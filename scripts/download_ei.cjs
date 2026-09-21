#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EI_DIR = path.join(__dirname, '..', 'src-tauri', 'resources', 'ei');
const GITHUB_API = 'https://api.github.com/repos/baaron4/GW2-Elite-Insights-Parser/releases/latest';

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const request = protocol.get(url, { headers: { 'User-Agent': 'Portal-Protocol' } }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        console.log(`Redirecting to ${response.headers.location}...`);
        download(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', reject);
  });
}

function unzip(zipPath, destDir) {
  if (zipPath.endsWith('.rpm')) {
    // Extract RPM using rpm2cpio + cpio (Linux only)
    execSync(`rpm2cpio '${zipPath}' | cpio -idmv -D '${destDir}'`, { stdio: 'inherit' });
  } else if (zipPath.endsWith('.deb')) {
    // Extract DEB using dpkg-deb (Linux only)
    execSync(`dpkg-deb -x '${zipPath}' '${destDir}'`, { stdio: 'inherit' });
  } else if (process.platform === 'win32') {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' });
  } else if (process.platform === 'darwin') {
    execSync(`unzip -o '${zipPath}' -d '${destDir}'`, { stdio: 'inherit' });
  } else {
    execSync(`unzip -o '${zipPath}' -d '${destDir}'`, { stdio: 'inherit' });
  }
}

function getPlatformZip(assets) {
  const platform = process.platform;
  const arch = process.arch;

  console.log(`Platform: ${platform}, Arch: ${arch}`);

  // Platform-specific patterns (be explicit to avoid matching wrong platform)
  // Prefer .zip files, fall back to platform-specific packages
  let pattern;
  if (platform === 'win32') {
    // Windows: only match the plain GW2EI.zip
    pattern = /^GW2EI[_-]win.*\.zip$/i;
  } else if (platform === 'darwin') {
    // macOS: match mac-specific zips, prefer arm64 on Apple Silicon
    pattern = arch === 'arm64' ? /^GW2EI[_-]osx[_-]arm.*\.zip$/i : /^GW2EI[_-]osx[_-]x64.*\.zip$/i;
  } else {
    // Linux: prefer .zip, then .deb, then .rpm
    pattern = arch === 'arm64' ? /^GW2EI[_-]linux[_-]arm.*\.zip$/i : /^GW2EI[_-]linux[_-]x64.*\.zip$/i;
  }

  let match = assets.find(a => pattern.test(a.name));

  // Fallback: if specific arch zip not found, try broader match for the platform
  if (!match) {
    if (platform === 'win32') {
      match = assets.find(a => /^GW2EI[_-]win.*\.zip$/i.test(a.name));
    } else if (platform === 'darwin') {
      match = assets.find(a => /^GW2EI[_-]osx.*\.zip$/i.test(a.name));
    } else {
      // Linux: prefer .deb over .rpm (both can be extracted)
      match = assets.find(a => /^GW2EI[_-]linux.*\.deb$/i.test(a.name));
      if (!match) {
        match = assets.find(a => /^GW2EI[_-]linux.*\.rpm$/i.test(a.name));
      }
    }
  }

  if (!match) {
    console.log('Available assets:');
    assets.forEach(a => console.log(`  - ${a.name}`));
    return null;
  }

  return match;
}

async function main() {
  console.log('Checking EI parser...');

  const cliExe = process.platform === 'win32' ? 'GuildWars2EliteInsights-CLI.exe' : 'GuildWars2EliteInsights-CLI';
  const cliPath = path.join(EI_DIR, cliExe);

  if (fs.existsSync(cliPath)) {
    console.log('EI parser already installed.');
    return;
  }

  console.log('Downloading latest EI parser...');

  // Get latest release
  const release = await new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Portal-Protocol' };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    https.get(GITHUB_API, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    }).on('error', reject);
  });

  if (!release || !release.assets || release.assets.length === 0) {
    console.error('No assets found in latest release.');
    process.exit(1);
  }

  const zipAsset = getPlatformZip(release.assets);

  if (!zipAsset) {
    console.error('Could not find appropriate EI zip for your platform.');
    process.exit(1);
  }

  console.log(`Found: ${zipAsset.name} (release ${release.tag_name})`);

  // Create temp directory
  const tmpDir = path.join(__dirname, '..', '.tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const zipPath = path.join(tmpDir, zipAsset.name);

  // Download
  console.log(`Downloading...`);
  await download(zipAsset.browser_download_url, zipPath);
  console.log('Download complete.');

  // Create EI directory
  if (!fs.existsSync(EI_DIR)) {
    fs.mkdirSync(EI_DIR, { recursive: true });
  }

  // Extract
  console.log('Extracting...');
  try {
    unzip(zipPath, EI_DIR);
    console.log('Extraction complete.');
  } catch (e) {
    console.error('Extraction failed:', e.message);
    process.exit(1);
  }

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('EI parser installed successfully!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
