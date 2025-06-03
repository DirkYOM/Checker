const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/{upnpc-static.exe}'  // Unpack the executable from ASAR
    },
    icon: path.join(__dirname, 'assets', 'yom-icon'),
    executableName: 'yom-node-inspector',
    extraResource: [
      // This places the file in resources/ directory outside of ASAR
      path.join(__dirname, 'resources', 'upnpc-static.exe')
    ]
  },

  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-wix',
      platforms: ['win32'],
      config: {
        name: 'YOM-Node-Inspector', // From existing packagerConfig.executableName or Squirrel config
        manufacturer: 'YOM', // From existing Squirrel config
        description: 'YOM Node Inspector app', // From package.json or existing Squirrel config
        exe: 'yom-node-inspector.exe', // From packagerConfig.executableName
        icon: path.join(__dirname, 'assets', 'yom-icon.ico'), // From packagerConfig.icon
        language: 1033, // English - United States
        ui: {
          chooseDirectory: true,
          // It's good practice to also define a EULA, but we don't have one provided.
          // Example: wixTemplate: path.join(__dirname, 'wix-template.xml') // if custom template is needed
        },
        // Consider adding a persistent upgradeCode (UUID) in the future for better update management.
        // For now, let it auto-generate. Example: upgradeCode: 'YOUR-GUID-HERE'
        // Desktop shortcut should be created by default with electron-wix-msi.
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32', 'linux'],
      config: {}
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    packagerStarted: () => {
      console.log('Packager started');
    },
    prePackage: async () => {
      console.log('Pre-package hook running');
      
      const logsDir = path.join(__dirname, 'build-logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      
      fs.appendFileSync(
        path.join(logsDir, 'build.log'),
        `Build started at ${new Date().toISOString()}\n`
      );

      const resourcesDir = path.join(__dirname, 'resources');
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
        console.log(`Created resources directory: ${resourcesDir}`);
      }

      const upnpcPath = path.join(resourcesDir, 'upnpc-static.exe');
      if (!fs.existsSync(upnpcPath)) {
        console.warn(`WARNING: upnpc-static.exe not found at ${upnpcPath}`);
      } else {
        console.log(`✓ upnpc-static.exe found at ${upnpcPath}`);
        
        try {
          fs.accessSync(upnpcPath, fs.constants.F_OK | fs.constants.R_OK);
          console.log('✓ upnpc-static.exe is readable');
        } catch (err) {
          console.error(`✗ upnpc-static.exe access error: ${err.message}`);
        }
      }
    },
    postPackage: async (config, packageResult) => {
      console.log('Package created successfully');
      console.log('Output path:', packageResult.outputPaths[0]);
      
      const outputPath = packageResult.outputPaths[0];
      
      // Check the extraResource location (this is where your file actually is!)
      const extraResourcePath = path.join(outputPath, 'resources', 'upnpc-static.exe');
      
      console.log(`Checking extraResource path: ${extraResourcePath}`);
      console.log(`✓ ExtraResource exists: ${fs.existsSync(extraResourcePath)}`);
      
      if (fs.existsSync(extraResourcePath)) {
        console.log('✓ upnpc-static.exe successfully packaged via extraResource');
        
        try {
          fs.accessSync(extraResourcePath, fs.constants.F_OK | fs.constants.R_OK);
          console.log('✓ upnpc-static.exe is accessible and ready to execute');
        } catch (err) {
          console.error(`✗ upnpc-static.exe access error: ${err.message}`);
        }
      } else {
        console.error('✗ upnpc-static.exe NOT found in extraResource location');
      }
      
      // Also check if unpacked version exists (for debugging)
      const unpackedPath = path.join(outputPath, 'resources', 'app.asar.unpacked', 'resources', 'upnpc-static.exe');
      if (fs.existsSync(unpackedPath)) {
        console.log('✓ Also found unpacked version at:', unpackedPath);
      }
      
      // List all contents for debugging
      try {
        const resourcesPath = path.join(outputPath, 'resources');
        console.log('Contents of resources directory:');
        fs.readdirSync(resourcesPath).forEach(file => {
          console.log(`  - ${file}`);
        });
      } catch (err) {
        console.error(`Error listing directory: ${err.message}`);
      }
      
      const logsDir = path.join(__dirname, 'build-logs');
      fs.appendFileSync(
        path.join(logsDir, 'build.log'),
        `Package created at ${new Date().toISOString()}\n` +
        `Output paths: ${packageResult.outputPaths.join(', ')}\n` +
        `ExtraResource exe exists: ${fs.existsSync(extraResourcePath)}\n`
      );
    },
    postMake: async (config, makeResults) => {
      console.log('Installers created successfully:');
      
      makeResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.name} for ${result.platform}-${result.arch}`);
        console.log(`   Artifacts: ${result.artifacts.join(', ')}`);
      });
    }
  }
};