const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const { sendSystemInfoEmail } = require('./utils/send-email');

// Initialize logger first
const logger = require('./logger');
logger.info('Application starting up');

const { performTraceroute } = require('./common/traceroute');

const TRACEROUTE_TARGETS = ['yom.network', '8.8.8.8']; // Default configurable targets

// Import platform detector
const { detectPlatformDetailed } = require('./platforms/platform-detector');

// We'll dynamically load the platform-specific modules based on detected platform
let platformChecks;
let platformInfo;

// Import common modules
const systemInfo = require('./common/system-info');

let mainWindow;

/**
 * Sets up first-run configuration
 */
async function setupFirstRun() {
    logger.info('Running first-time setup checks');
    
    // Check if this is first run
    const userDataPath = app.getPath('userData');
    const firstRunFlag = path.join(userDataPath, '.first-run-completed');
    
    if (!fs.existsSync(firstRunFlag)) {
        logger.info('First run detected, performing setup tasks');
        
        // Create configuration directory
        const configDir = path.join(userDataPath, 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Create resources directory if it doesn't exist
        const resourcesDir = path.join(userDataPath, 'resources');
        if (!fs.existsSync(resourcesDir)) {
            fs.mkdirSync(resourcesDir, { recursive: true });
        }
        
        // Check if upnpc-static.exe exists in app resources and copy to user resources
        try {
            const appResourcePath = path.join(app.getAppPath(), 'resources', 'upnpc-static.exe');
            const userResourcePath = path.join(resourcesDir, 'upnpc-static.exe');
            
            if (fs.existsSync(appResourcePath) && !fs.existsSync(userResourcePath)) {
                fs.copyFileSync(appResourcePath, userResourcePath);
                logger.info(`Copied upnpc-static.exe to user resources: ${userResourcePath}`);
            }
        } catch (err) {
            logger.error(`Error copying upnpc-static.exe: ${err.message}`);
        }
        
        // Create default .env file if it doesn't exist
        const envPath = path.join(configDir, '.env');
        if (!fs.existsSync(envPath)) {
            const defaultEnv = 
                'NODE_ENV=production\n' +
                `INSTALLATION_PATH=${app.getAppPath()}\n` +
                'REPORT_EMAIL=rohan@yom.ooo\n' +
                `USER_DATA_PATH=${userDataPath}\n`;
            
            fs.writeFileSync(envPath, defaultEnv);
            logger.info('Created default environment configuration');
        }
        
        // Create first run flag
        fs.writeFileSync(firstRunFlag, new Date().toISOString());
        logger.info('First-run setup completed');
        
        // Log installation completion
        logger.logInstallation({
            event: 'first-run-complete',
            installPath: app.getAppPath(),
            userDataPath: userDataPath
        });
    } else {
        logger.info('Not first run, skipping setup tasks');
    }
    
    // Desktop shortcuts are now handled by the WiX installer.
    // The Squirrel specific shortcut creation logic has been removed.
}

/**
 * Finds the path to upnpc-static.exe
 * @returns {Promise<string|null>} Path to upnpc-static.exe or null if not found
 */
async function findUpnpcPath() {
    logger.info(`Finding upnpc-static.exe. Is packaged: ${app.isPackaged}`);
    
    const possiblePaths = [];
    
    if (app.isPackaged) {
        const appPath = app.getAppPath(); // Typically [INSTALL_DIR]/resources/app.asar
        const resourcesDir = path.dirname(appPath); // Typically [INSTALL_DIR]/resources

        // HIGHEST PRIORITY for packaged apps:
        // Expected location for `extraResource` files like `upnpc-static.exe` when installed.
        // e.g., [INSTALL_DIR]/resources/upnpc-static.exe (if app.asar is in [INSTALL_DIR]/resources)
        // or [INSTALL_DIR]/upnpc-static.exe (if app.asar is in [INSTALL_DIR]) - needs verification based on actual build output
        // For electron-forge, extraResources are usually copied next to the unpacked app.asar, so path.dirname(app.getAppPath()) should be correct.
        possiblePaths.push(path.join(resourcesDir, 'upnpc-static.exe'));
        logger.debug(`Packaged: Adding primary path: ${path.join(resourcesDir, 'upnpc-static.exe')}`);

        // Secondary path for packaged apps (less common for extraResource)
        // This might point to [INSTALL_DIR]/upnpc-static.exe if app.asar is in [INSTALL_DIR]/resources
        possiblePaths.push(path.join(appPath, '..', 'upnpc-static.exe'));
        logger.debug(`Packaged: Adding secondary path: ${path.join(appPath, '..', 'upnpc-static.exe')}`);
        
        // Fallback for asar unpacked scenarios
        possiblePaths.push(path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'upnpc-static.exe'));
        logger.debug(`Packaged: Adding ASAR unpacked path: ${path.join(resourcesDir, 'app.asar.unpacked', 'resources', 'upnpc-static.exe')}`);

    } else {
        // Development path - Highest priority when not packaged
        possiblePaths.push(path.join(__dirname, 'resources', 'upnpc-static.exe'));
        logger.debug(`Development: Adding primary path: ${path.join(__dirname, 'resources', 'upnpc-static.exe')}`);
        
        // Another common dev path (if resources is sibling to main.js but not in __dirname)
        possiblePaths.push(path.join(app.getAppPath(), 'resources', 'upnpc-static.exe'));
        logger.debug(`Development: Adding secondary path: ${path.join(app.getAppPath(), 'resources', 'upnpc-static.exe')}`);
    }
    
    // User data path - Fallback for both packaged and development, if copied there by setupFirstRun or other logic
    possiblePaths.push(path.join(app.getPath('userData'), 'resources', 'upnpc-static.exe'));
    logger.debug(`Fallback: Adding user data path: ${path.join(app.getPath('userData'), 'resources', 'upnpc-static.exe')}`);

    // Commenting out Program Files paths as they are less predictable with WiX user-configurable installation
    // possiblePaths.push(path.join(process.env.ProgramFiles || '', 'YOM', 'YOM Node Inspector', 'resources', 'upnpc-static.exe'));
    // possiblePaths.push(path.join(process.env['ProgramFiles(x86)'] || '', 'YOM', 'YOM Node Inspector', 'resources', 'upnpc-static.exe'));
    
    logger.debug(`Searching for upnpc-static.exe in ${possiblePaths.length} possible locations`);
    
    // Check each path in order
    for (let i = 0; i < possiblePaths.length; i++) {
        const testPath = possiblePaths[i];
        try {
            logger.debug(`[${i + 1}/${possiblePaths.length}] Checking: ${testPath}`);
            
            if (fs.existsSync(testPath)) {
                // CRITICAL: Skip ASAR paths - they exist but can't be executed
                if (testPath.includes('app.asar' + path.sep) || testPath.includes('app.asar/')) {
                    logger.debug(`Skipping ASAR path (not executable): ${testPath}`);
                    continue;
                }
                
                try {
                    // Verify it's actually accessible and executable
                    fs.accessSync(testPath, fs.constants.F_OK | fs.constants.R_OK);
                    logger.info(`✓ Found upnpc-static.exe at: ${testPath}`);
                    return testPath;
                } catch (accessErr) {
                    logger.warn(`File exists but not accessible: ${testPath} - ${accessErr.message}`);
                }
            }
        } catch (err) {
            logger.debug(`Error checking path ${testPath}: ${err.message}`);
        }
    }
    
    // Enhanced debugging for packaged apps
    if (app.isPackaged) {
        logger.warn('upnpc-static.exe not found. Performing detailed diagnosis...');
        
        try {
            const appDir = path.dirname(app.getAppPath());
            const resourcesPath = path.join(appDir, 'resources'); // FIXED: removed duplicate 'resources'
            
            logger.debug(`App directory: ${appDir}`);
            logger.debug(`Resources path: ${resourcesPath}`);
            logger.debug(`Resources path exists: ${fs.existsSync(resourcesPath)}`);
            
            if (fs.existsSync(resourcesPath)) {
                const contents = fs.readdirSync(resourcesPath);
                logger.debug(`Contents of resources directory: ${contents.join(', ')}`);
                
                // Specifically look for our executable
                const hasUpnpc = contents.includes('upnpc-static.exe');
                logger.debug(`upnpc-static.exe in resources directory: ${hasUpnpc}`);
                
                if (hasUpnpc) {
                    const directPath = path.join(resourcesPath, 'upnpc-static.exe');
                    logger.debug(`Direct path: ${directPath}`);
                    logger.debug(`Direct path accessible: ${fs.existsSync(directPath)}`);
                    
                    // This should work if we reach this point
                    try {
                        fs.accessSync(directPath, fs.constants.F_OK | fs.constants.R_OK);
                        logger.info(`✓ Found upnpc-static.exe via diagnosis: ${directPath}`);
                        return directPath;
                    } catch (accessErr) {
                        logger.error(`Diagnosis found file but access failed: ${accessErr.message}`);
                    }
                }
            }
        } catch (debugErr) {
            logger.error(`Error during diagnostic: ${debugErr.message}`);
        }
    }
    
    logger.error('upnpc-static.exe not found in any location');
    return null;
}

/**
 * Creates the main application window
 */
function createWindow() {
    logger.info('Creating main application window');
    
    mainWindow = new BrowserWindow({
        width: 1500,
        height: 1200,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(app.getAppPath(), 'assets', 'yom-icon.ico')
    });

    mainWindow.loadFile('index.html');
    Menu.setApplicationMenu(null);
    
    // Log window creation
    logger.info('Main window created and loaded');
}

/**
 * Sets up all IPC handlers for communication with renderer process
 */
function setupIpcHandlers() {
    logger.info('Setting up IPC handlers');
    
    // Get Public IP using multiple fallback methods
    ipcMain.handle('get-public-ip', async () => {
        logger.info('Handling get-public-ip request');
        try {
            // First try UPnP method with miniupnpc
            const upnpcPath = await findUpnpcPath();
            if (upnpcPath) {
                logger.debug('Attempting to get public IP using upnpc-static');
                // Use the platformChecks.getExternalIpWithUpnpc if available
                if (platformChecks.getExternalIpWithUpnpc) {
                    const ip = await platformChecks.getExternalIpWithUpnpc(upnpcPath);
                    if (ip) {
                        logger.info(`Got public IP via upnpc-static: ${ip}`);
                        return ip;
                    }
                }
            }

            // Fallback to public IP API
            logger.debug('Attempting to get public IP via API');
            return new Promise((resolve) => {
                https.get('https://api.ipify.org', (resp) => {
                    let data = '';
                    resp.on('data', (chunk) => {
                        data += chunk;
                    });
                    resp.on('end', () => {
                        const ip = data.trim();
                        logger.info(`Got public IP via API: ${ip}`);
                        resolve(ip);
                    });
                }).on('error', (err) => {
                    // If all methods fail, return local IP
                    logger.warn(`Error getting public IP via API: ${err.message}`);
                    logger.debug('Falling back to local IP');
                    
                    const interfaces = os.networkInterfaces();
                    for (const name of Object.keys(interfaces)) {
                        for (const interface of interfaces[name]) {
                            // Skip internal and non-IPv4 addresses
                            if (!interface.internal && interface.family === 'IPv4') {
                                logger.info(`Using local IP as fallback: ${interface.address}`);
                                resolve(interface.address);
                                return;
                            }
                        }
                    }
                    logger.error('Unable to determine any IP address');
                    resolve('Unable to detect IP');
                });
            });
        } catch (error) {
            logger.error(`Error getting public IP: ${error.message}`, { stack: error.stack });
            return 'Error detecting IP';
        }
    });
    
    // Platform-specific handlers
    ipcMain.handle('check-upnp-comprehensive', async () => {
        logger.info('Handling check-upnp-comprehensive request');
        try {
            return await platformChecks.checkUPnPComprehensive();
        } catch (error) {
            logger.error(`Error in 'check-upnp-comprehensive' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to perform comprehensive UPnP check: ${error.message}`);
        }
    });
    
    ipcMain.handle('check-partition-style', async () => {
        logger.info('Handling check-partition-style request');
        try {
            return await platformChecks.checkPartitionStyle();
        } catch (error) {
            logger.error(`Error in 'check-partition-style' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to check partition style: ${error.message}`);
        }
    });
    
    // Common handlers
    ipcMain.handle('get-gpu-info', async () => {
        logger.info('Handling get-gpu-info request');
        try {
            return await systemInfo.getGPUInfo();
        } catch (error) {
            logger.error(`Error in 'get-gpu-info' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to get GPU information: ${error.message}`);
        }
    });


     ipcMain.on('quit-app', () => {
        logger.info('Quit button clicked, shutting down application');
        app.quit();
    });
    
    ipcMain.handle('get-os-info', async () => {
        logger.info('Handling get-os-info request');
        try {
            return await systemInfo.getOSInfo();
        } catch (error) {
            logger.error(`Error in 'get-os-info' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to get OS information: ${error.message}`);
        }
    });
    
    ipcMain.handle('get-system-info', async () => {
        logger.info('Handling get-system-info request');
        try {
            return await systemInfo.getSystemInfo();
        } catch (error) {
            logger.error(`Error in 'get-system-info' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to get system information: ${error.message}`);
        }
    });
    
    // Path configuration handlers
    ipcMain.handle('get-app-paths', () => {
        logger.info('Handling get-app-paths request');
        try {
            return {
                appPath: app.getAppPath(),
                userData: app.getPath('userData'),
                temp: app.getPath('temp'),
                upnpc: findUpnpcPath() // findUpnpcPath itself has logging
            };
        } catch (error) {
            logger.error(`Error in 'get-app-paths' handler: ${error.message}`, { stack: error.stack });
            // For synchronous handlers, we might need to return a structure or rethrow.
            // Since this one is simple, rethrowing is fine and will be caught by Electron.
            throw new Error(`Failed to get application paths: ${error.message}`);
        }
    });
    
    // Email reporting
    ipcMain.handle('send-email-report', async (event, { recipientEmail, systemInfo }) => {
        logger.info(`Handling send-email-report request to: ${recipientEmail}`);
        try {
            const result = await sendSystemInfoEmail(recipientEmail, systemInfo);
            return result;
        } catch (error) {
            logger.error(`Error sending email: ${error.message}`, { stack: error.stack });
            return {
                success: false,
                error: error.message
            };
        }
    });
    
    // Installation info
    ipcMain.handle('get-installation-info', () => {
        logger.info('Handling get-installation-info request');
        try {
            const shortcutPath = path.join(app.getPath('desktop'), 'YOM Node Inspector.lnk');
            let shortcutExists = false;
            try {
                shortcutExists = fs.existsSync(shortcutPath);
            } catch (fsError) {
                logger.warn(`Could not determine if shortcut exists at ${shortcutPath}: ${fsError.message}`);
                // Keep shortcutExists as false
            }

            return {
                appPath: app.getAppPath(),
                userData: app.getPath('userData'),
                version: app.getVersion(),
                exePath: app.getPath('exe'),
                shortcutPath: shortcutPath,
                shortcutExists: shortcutExists
            };
        } catch (error) {
            logger.error(`Error in 'get-installation-info' handler: ${error.message}`, { stack: error.stack });
            throw new Error(`Failed to get installation information: ${error.message}`);
        }
    });

    
    
    // Legacy handlers for backward compatibility
    setupLegacyHandlers();

    ipcMain.handle('get-traceroute-targets', async () => {
      // Ensure logger is accessible here or remove logger call if it causes issues in subtask
      // logger.info('Providing traceroute targets to renderer.');
      console.log('Main process: Providing traceroute targets to renderer.'); // Using console.log for subtask simplicity
      return TRACEROUTE_TARGETS;
    });

    ipcMain.handle('perform-traceroute', async (event, host) => {
      logger.info(`Handling perform-traceroute request for host: ${host}`);
      if (!mainWindow || mainWindow.isDestroyed()) {
        logger.error('Cannot perform traceroute, mainWindow is not available.');
        return { success: false, error: 'Main window not available.' };
      }

      try {
        performTraceroute(host, {
          onPid: (pid) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('traceroute-pid', { host, pid });
            }
          },
          onDestination: (destination) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('traceroute-destination', { host, destination });
            }
          },
          onHop: (hop) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('traceroute-hop', { host, hop });
            }
          },
          onClose: (code) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('traceroute-close', { host, code });
            }
          },
          onError: (err) => {
            // This error comes from the traceroute library itself (e.g. process error, parsing error)
            logger.error(`Error during traceroute for ${host}: ${err.message}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('traceroute-error', { host, error: { message: err.message } });
            }
          }
        });
        return { success: true, message: `Traceroute to ${host} initiated.` };
      } catch (initError) {
        // This error is if performTraceroute itself throws an error synchronously during setup
        logger.error(`Failed to initiate traceroute for ${host} in main.js: ${initError.message}`);
        return { success: false, error: `Failed to initiate traceroute: ${initError.message}` };
      }
    });
    
    logger.info('All IPC handlers set up successfully');
}

/**
 * Sets up legacy handlers for backward compatibility
 */
function setupLegacyHandlers() {
    logger.info('Setting up legacy IPC handlers for backward compatibility');
    
    // Legacy UPnP check - maintained for backwards compatibility
    ipcMain.handle('check-upnp', async () => {
        logger.info('Handling legacy check-upnp request');
        const logFile = path.join(app.getPath('userData'), 'upnp-debug.log');
        
        try {
            fs.appendFileSync(logFile, `UPnP check started at ${new Date().toISOString()}\n`);
        } catch (error) {
            logger.warn(`Could not write to UPnP debug log: ${error.message}`);
        }
        
        try {
            const result = await platformChecks.checkUPnPComprehensive();
            // Ensure a consistent return structure even on success, if desired, or just return result.
            // For this legacy handler, existing structure is fine.
            return result;
        } catch (error) {
            logger.error(`Legacy UPnP check failed: ${error.message}`, { stack: error.stack });
            try {
                fs.appendFileSync(logFile, `UPnP check exception: ${error.message}\n`);
            } catch (logError) {
                logger.warn(`Could not write error to UPnP debug log: ${logError.message}`);
            }
            // Return a consistent error structure that the renderer might expect
            return { enabled: false, error: `Legacy UPnP check failed: ${error.message}` };
        }
    });
}

/**
 * Helper function to get public IP via UPnP
 * @returns {Promise<string|null>} Public IP or null if not available
 */
async function getPublicIpViaUpnp() {
    try {
        const upnpcPath = await findUpnpcPath();
        if (upnpcPath && platformChecks.getExternalIpWithUpnpc) {
            return await platformChecks.getExternalIpWithUpnpc(upnpcPath);
        }
        return null;
    } catch (error) {
        logger.error(`Error in getPublicIpViaUpnp: ${error.message}`);
        return null;
    }
}

/**
 * Initializes the application and loads platform-specific modules
 */
async function initializeApp() {
    try {
        // Detect platform first
        platformInfo = await detectPlatformDetailed();
        logger.info(`Platform detection complete: ${platformInfo.platform}`);
        
        // Log detailed platform information
        logger.info(`OS: ${platformInfo.osDetails}`);
        logger.info(`Architecture: ${platformInfo.arch}`);
        
        // Load platform-specific checks based on detected platform
        if (platformInfo.isWindows) {
            logger.info('Loading Windows-specific modules');
            platformChecks = require('./platforms/windows-checks');
        } else if (platformInfo.isLinux) {
            logger.info('Loading Linux-specific modules');
            platformChecks = require('./platforms/linux-checks');
        } else {
            logger.error(`Unsupported platform: ${platformInfo.platform}`);
            throw new Error(`Unsupported platform: ${platformInfo.platform}`);
        }
        
        // Set up IPC handlers
        setupIpcHandlers();
        
        // Create window
        createWindow();
        
    } catch (error) {
        logger.error(`Error during app initialization: ${error.message}`, { stack: error.stack });
        
        if (app.isReady()) {
            createErrorWindow(error);
        } else {
            app.once('ready', () => createErrorWindow(error));
        }
    }
}

/**
 * Creates an error window to display initialization errors
 * @param {Error} error - The error that occurred
 */
function createErrorWindow(error) {
    const errorWindow = new BrowserWindow({
        width: 600,
        height: 400,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    
    // Create a simple HTML file with the error message
    const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>System Checker Error</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #d9534f; }
                .error { background-color: #f9f2f4; padding: 10px; border-radius: 4px; overflow-wrap: break-word; }
            </style>
        </head>
        <body>
            <h1>Application Error</h1>
            <p>The application could not start due to an error:</p>
            <div class="error">
                <strong>${error.message}</strong>
                <pre>${error.stack}</pre>
            </div>
            <p>Please check the logs for more information.</p>
        </body>
        </html>
    `;
    
    const errorPath = path.join(app.getPath('temp'), 'system-checker-error.html');
    fs.writeFileSync(errorPath, errorHtml);
    
    errorWindow.loadFile(errorPath);
    Menu.setApplicationMenu(null);
}

// When app is ready, run first-time setup and initialize
app.whenReady().then(async () => {
    await setupFirstRun();
    await initializeApp();
});

// Handle application lifecycle events
app.on('window-all-closed', () => {
    logger.info('All windows closed, shutting down application');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    logger.info('Application activated');
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', { 
        message: error.message,
        stack: error.stack
    });
    
    if (app.isReady() && !mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send('error', {
            message: error.message,
            stack: error.stack
        });
    }
});

// Log app shutdown
app.on('quit', () => {
    logger.info('Application shutting down');
});