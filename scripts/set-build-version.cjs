/**
 * TransTrack - Build Version Setter
 * 
 * Sets the build version (evaluation or enterprise) before building.
 * Creates a marker file that the application uses to detect its version.
 * 
 * Usage: node scripts/set-build-version.js [evaluation|enterprise]
 */

const fs = require('fs');
const path = require('path');

const BUILD_VERSIONS = ['evaluation', 'enterprise'];

function main() {
  const version = process.argv[2]?.toLowerCase();
  
  if (!version || !BUILD_VERSIONS.includes(version)) {
    console.error('Usage: node scripts/set-build-version.js [evaluation|enterprise]');
    console.error('');
    console.error('Available versions:');
    console.error('  evaluation  - Demo/trial build with restrictions');
    console.error('  enterprise  - Full production build with license enforcement');
    process.exit(1);
  }
  
  // Write build version marker file
  const markerPath = path.join(__dirname, '..', '.build-version');
  fs.writeFileSync(markerPath, version);
  console.log(`Build version set to: ${version}`);
  
  // Also write to electron directory for packaged builds
  const electronMarkerPath = path.join(__dirname, '..', 'electron', '.build-version');
  fs.writeFileSync(electronMarkerPath, version);
  
  // Set environment variable for current process
  process.env.TRANSTRACK_BUILD_VERSION = version;
  
  // Log build info
  console.log('');
  console.log('Build Configuration:');
  console.log('====================');
  
  if (version === 'evaluation') {
    console.log('Version: Evaluation / Demo');
    console.log('Features:');
    console.log('  - 14-day trial period');
    console.log('  - Max 50 patients');
    console.log('  - Max 5 donors');
    console.log('  - Single user only');
    console.log('  - No data export');
    console.log('  - No FHIR integration');
    console.log('  - Watermarked UI');
    console.log('  - Cannot activate license');
    console.log('');
    console.log('Output: TransTrack-Evaluation-[version]');
  } else {
    console.log('Version: Enterprise / Production');
    console.log('Features:');
    console.log('  - Full feature set');
    console.log('  - License enforcement');
    console.log('  - All tiers supported (Starter, Professional, Enterprise)');
    console.log('  - Organization binding');
    console.log('  - Maintenance tracking');
    console.log('');
    console.log('Output: TransTrack-Enterprise-[version]');
  }
  
  console.log('');
  console.log('Build version set successfully!');
}

main();
