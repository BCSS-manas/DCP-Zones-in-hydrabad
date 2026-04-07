const fs = require('fs');
const path = require('path');

const geoSourcePath = path.join(__dirname, 'new folder', 'telangana-police-officers-map (1).html');
const geoDestPath = path.join(__dirname, 'geo.js');

try {
  console.log('=== Telangana Police Map — Build Script ===');
  console.log('Reading reference HTML from:', geoSourcePath);
  
  const html = fs.readFileSync(geoSourcePath, 'utf8');
  
  // ── Extract GEO JSON ──────────────────────────────────────
  const marker = 'const GEO = ';
  const geoIdx = html.indexOf(marker);
  
  if (geoIdx === -1) {
    throw new Error('Could not find "const GEO = " in the reference HTML file.');
  }
  
  // Start after "const GEO = "
  const jsonStart = geoIdx + marker.length;
  
  // Find the matching end of the JSON object by counting braces
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }
  
  if (jsonEnd === -1) {
    throw new Error('Could not find the end of the GEO JSON object.');
  }
  
  const geoJson = html.substring(jsonStart, jsonEnd);
  
  // Validate it's real JSON
  const parsed = JSON.parse(geoJson);
  const featureCount = parsed.features ? parsed.features.length : 0;
  console.log(`✓ Extracted GeoJSON: ${featureCount} features (${(geoJson.length / 1024).toFixed(0)} KB)`);
  
  // Write geo.js
  const geoContent = `// Auto-generated GeoJSON boundary data\n// Source: telangana-police-officers-map (1).html\n// Features: ${featureCount}\nconst GEO = ${geoJson};\n`;
  fs.writeFileSync(geoDestPath, geoContent);
  console.log(`✓ Saved to: ${geoDestPath}`);
  
  console.log('\n=== BUILD COMPLETE ===');
  console.log('Now open index.html in your browser!');
  
} catch (err) {
  console.error('\n✗ BUILD FAILED:', err.message);
  console.error(err.stack);
}
