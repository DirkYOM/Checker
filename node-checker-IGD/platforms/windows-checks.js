const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execPromise = promisify(exec);
const { app } = require('electron');
const logger = require('../logger');
const os = require('os');
const https = require('https');

/**
 * Checks if UPnP tool is available on Windows
 * @returns {Promise<boolean>} True if tool is available
 */
async function checkWindowsUPnPToolAvailability() {
    logger.info('Checking if UPnP tool is available on Windows');
    
    // Look for upnpc-static.exe in the correct locations based on packaging
    const exePaths = [];
    
    if (app.isPackaged) {
        const appPath = app.getAppPath();
        const appDir = path.dirname(appPath);
        
        // PRIMARY: Check extraResource location (where the file is actually placed and EXECUTABLE)
        // This is outside ASAR and can be executed - FIXED: removed duplicate 'resources'
        exePaths.push(path.join(appDir, 'resources', 'upnpc-static.exe'));
        
        // SECONDARY: Alternative packaged locations (also outside ASAR)
        exePaths.push(path.join(appPath, '..', 'upnpc-static.exe'));
        
        // TERTIARY: Check unpacked ASAR location (if using asar unpack)
        exePaths.push(path.join(appDir, 'resources', 'app.asar.unpacked', 'resources', 'upnpc-static.exe'));
        exePaths.push(path.join(appPath, '..', 'app.asar.unpacked', 'resources', 'upnpc-static.exe'));
        
        // NOTE: We deliberately DO NOT check inside app.asar because executables there cannot be run
        // Even though fs.existsSync() might return true for app.asar files, they are not executable
    }
    
    // Add development and fallback paths
    exePaths.push(
        path.join(app.getAppPath(), 'resources', 'upnpc-static.exe'),
        path.join(__dirname, '..', 'resources', 'upnpc-static.exe'), // Go up one level from platforms/
        path.join(app.getPath('userData'), 'resources', 'upnpc-static.exe'),
        path.join(process.env.ProgramFiles || '', 'YOM', 'YOM Node Inspector', 'resources', 'upnpc-static.exe'),
        path.join(process.env['ProgramFiles(x86)'] || '', 'YOM', 'YOM Node Inspector', 'resources', 'upnpc-static.exe')
    );
    
    logger.debug(`Searching for upnpc-static.exe in ${exePaths.length} locations`);
    
    for (let i = 0; i < exePaths.length; i++) {
        const exePath = exePaths[i];
        try {
            logger.debug(`[${i + 1}/${exePaths.length}] Checking: ${exePath}`);
            
            if (fs.existsSync(exePath)) {
                // CRITICAL: Verify it's actually accessible AND not inside ASAR
                // fs.existsSync() returns true for ASAR files, but they can't be executed
                if (exePath.includes('app.asar' + path.sep) || exePath.includes('app.asar/')) {
                    logger.debug(`Skipping ASAR path (not executable): ${exePath}`);
                    continue;
                }
                
                try {
                    fs.accessSync(exePath, fs.constants.F_OK | fs.constants.R_OK);
                    logger.info(`✓ Found upnpc-static.exe at: ${exePath}`);
                    return { available: true, path: exePath };
                } catch (accessErr) {
                    logger.warn(`File exists but not accessible: ${exePath} - ${accessErr.message}`);
                }
            }
        } catch (err) {
            logger.debug(`Error checking path ${exePath}: ${err.message}`);
            // Continue checking other paths
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
                    
                    // This should work if we reach this point
                    try {
                        fs.accessSync(directPath, fs.constants.F_OK | fs.constants.R_OK);
                        logger.info(`✓ Found upnpc-static.exe via diagnosis: ${directPath}`);
                        return { available: true, path: directPath };
                    } catch (accessErr) {
                        logger.error(`Diagnosis found file but access failed: ${accessErr.message}`);
                    }
                }
            }
        } catch (debugErr) {
            logger.error(`Error during diagnostic: ${debugErr.message}`);
        }
    }
    
    logger.warn('upnpc-static.exe not found in any location');
    
    // For Windows, we don't attempt to download - just return not available
    logger.warn('UPnP tool not available - installation may be incomplete');
    return { available: false };
}

/**
 * Extract external IP address from upnpc output
 * @param {string} output - The output from upnpc command
 * @returns {string|null} The external IP address or null if not found
 */
function extractExternalIp(output) {
    // Example output pattern: "ExternalIPAddress = 203.0.113.10"
    const match = output.match(/ExternalIPAddress\s*=\s*([0-9.]+)/i);
    if (match && match[1]) {
        return match[1];
    }
    return null;
}

/**
 * Get external IP address using upnpc tool
 * @param {string} upnpcPath - Path to upnpc executable
 * @returns {Promise<string|null>} External IP or null if not found
 */
async function getExternalIpWithUpnpc(upnpcPath) {
    try {
        logger.debug(`Getting external IP using upnpc at: ${upnpcPath}`);
        const { stdout } = await execPromise(`"${upnpcPath}" -s`);
        const ip = extractExternalIp(stdout);
        if (ip) {
            logger.info(`External IP via upnpc: ${ip}`);
        } else {
            logger.warn('Could not extract external IP from upnpc output');
        }
        return ip;
    } catch (error) {
        logger.error(`Error getting external IP with upnpc: ${error.message}`);
        return null;
    }
}

/**
 * Get external IP address from public API as fallback
 * @returns {Promise<string|null>} External IP or null if not found
 */
async function getExternalIpFromApi() {
    return new Promise((resolve) => {
        https.get('https://api.ipify.org', (resp) => {
            let data = '';
            resp.on('data', (chunk) => {
                data += chunk;
            });
            resp.on('end', () => {
                const ip = data.trim();
                logger.info(`External IP via API: ${ip}`);
                resolve(ip);
            });
        }).on('error', (err) => {
            logger.error(`Error getting IP from API: ${err.message}`);
            resolve(null);
        });
    });
}

/**
 * Check UPnP using Windows-specific tools
 * @returns {Promise<Object>} UPnP status object
 */
async function checkUPnPWindows() {
    logger.info('Windows UPnP check started');
    
    const result = {
        igdDetected: false,
        addMapping: false,
        removeMapping: false,
        status: 'FAIL',
        details: {},
        recommendations: [],
        platform: 'windows',
        enabled: false
    };
    
    try {
        // Find the path to upnpc-static.exe
        const toolCheck = await checkWindowsUPnPToolAvailability();
        if (!toolCheck.available) {
            logger.warn('upnpc-static.exe not found');
            result.details.error = "upnpc-static.exe not found";
            result.recommendations.push("UPnP checking tool not found. This may be resolved after installation.");
            return result;
        }
        
        const upnpcPath = toolCheck.path;
        logger.info(`Using upnpc-static.exe at: ${upnpcPath}`);
        
        // Step 1: Check for IGD presence
        logger.debug('Running UPnP device list command');
        const { stdout: listOutput } = await execPromise(`"${upnpcPath}" -l`);
        logger.debug(`UPnP list output: ${listOutput}`);
        
        if (listOutput.includes('No IGD UPnP Device found') || 
            listOutput.includes('No valid UPNP Internet Gateway Device found')) {
            logger.warn('No IGD UPnP Device found');
            result.details.error = "No IGD detected on the network";
            result.recommendations.push("Check if your router supports UPnP and make sure it's enabled");
            return result;
        }
        
        result.igdDetected = true;
        result.details.igdInfo = listOutput;
        logger.info('IGD UPnP Device detected successfully');
        
        // Get external IP
        const externalIp = await getExternalIpWithUpnpc(upnpcPath) || await getExternalIpFromApi();
        if (externalIp) {
            result.details.externalIp = externalIp;
        }
        
        // Extract local IP address 
        const interfaces = os.networkInterfaces();
        let localIp = '';
        
        logger.debug('Looking for local IP address');
        for (const name of Object.keys(interfaces)) {
            for (const interface of interfaces[name]) {
                if (!interface.internal && interface.family === 'IPv4') {
                    localIp = interface.address;
                    break;
                }
            }
            if (localIp) break;
        }
        
        if (!localIp) {
            logger.error('Could not determine local IP address');
            result.details.error = "Could not determine local IP address";
            return result;
        }
        
        logger.debug(`Using local IP: ${localIp}`);
        
        // Step 2: Try to add a test mapping
        const testPort = 44444;
        try {
            logger.debug(`Attempting to add UPnP mapping for port ${testPort}`);
            const { stdout: addOutput } = await execPromise(
                `"${upnpcPath}" -a ${localIp} ${testPort} ${testPort} TCP 0`
            );
            
            logger.debug(`Add mapping output: ${addOutput}`);
            result.addMapping = !addOutput.includes('failed') && !addOutput.includes('error');
            result.details.addOutput = addOutput;
            
            if (result.addMapping) {
                logger.info(`Successfully added UPnP mapping for port ${testPort}`);
            } else {
                logger.warn(`Failed to add UPnP mapping for port ${testPort}`);
            }
        } catch (error) {
            logger.error(`Add mapping error: ${error.message}`);
            result.addMapping = false;
            result.details.addError = error.message;
        }
        
        // Step 3: Try to remove the test mapping
        try {
            logger.debug(`Attempting to remove UPnP mapping for port ${testPort}`);
            const { stdout: removeOutput } = await execPromise(
                `"${upnpcPath}" -d ${testPort} TCP`
            );
            
            logger.debug(`Remove mapping output: ${removeOutput}`);
            result.removeMapping = !removeOutput.includes('failed') && !removeOutput.includes('error');
            result.details.removeOutput = removeOutput;
            
            if (result.removeMapping) {
                logger.info(`Successfully removed UPnP mapping for port ${testPort}`);
            } else {
                logger.warn(`Failed to remove UPnP mapping for port ${testPort}`);
            }
        } catch (error) {
            logger.error(`Remove mapping error: ${error.message}`);
            result.removeMapping = false;
            result.details.removeError = error.message;
        }
        
        // Determine scenario based on results
        if (result.igdDetected && result.addMapping && result.removeMapping) {
            result.status = 'PASS';
            result.enabled = true;
            logger.info('UPnP check passed successfully');
        } else if (result.igdDetected && (result.addMapping || result.removeMapping)) {
            result.status = 'PARTIAL_PASS';
            result.enabled = true;
            result.recommendations.push("Additional router settings may be required");
            logger.info('UPnP check partially passed');
        } else {
            result.status = 'FAIL';
            // Set enabled true if IGD is detected (even if port operations fail)
            result.enabled = result.igdDetected;
            if (result.igdDetected) {
                result.recommendations.push("UPnP is detected but port mapping operations failed. Check router settings.");
                logger.warn('UPnP device detected but operations failed');
            } else {
                logger.warn('UPnP check failed completely');
            }
        }
        
        logger.info(`Windows UPnP final result: ${result.status}, enabled: ${result.enabled}`);
        return result;
    } catch (error) {
        logger.error(`Windows UPnP check error: ${error.message}`, { stack: error.stack });
        result.details.error = error.message;
        return result;
    }
}

/**
 * Check disk partition style on Windows (MBR/GPT)
 * @returns {Promise<Object>} Partition information
 */
async function checkWindowsPartitionStyle() {
    logger.info('Checking Windows partition style');
    
    try {
        // Windows-specific command using PowerShell
        const { stdout } = await execPromise('powershell "Get-Disk | Select-Object -Property Number, PartitionStyle | Format-List"');
        logger.debug(`Partition style raw output: ${stdout}`);
        
        const formatted = formatWindowsPartitionOutput(stdout);
        
        logger.info(`Successfully retrieved Windows partition information`);
        return { 
            style: stdout,
            platform: 'windows',
            formatted: formatted
        };
    } catch (error) {
        logger.error(`Error reading Windows partition information: ${error.message}`);
        return { 
            error: 'Error reading Windows partition information', 
            details: error.message,
            platform: 'windows'
        };
    }
}

/**
 * Helper function to format Windows partition output
 * @param {string} output - Raw output from PowerShell command
 * @returns {Array<Object>|null} Formatted partition information
 */
function formatWindowsPartitionOutput(output) {
    try {
        const disks = output.split('\n\n').filter(disk => disk.trim());
        const formatted = disks.map(disk => {
            const number = disk.match(/Number\s*:\s*(\d+)/)?.[1];
            const style = disk.match(/PartitionStyle\s*:\s*(\w+)/)?.[1];
            return { number, style };
        });
        
        logger.debug(`Formatted ${formatted.length} disk(s) information`);
        return formatted;
    } catch (error) {
        logger.error(`Error formatting Windows partition output: ${error.message}`);
        return null;
    }
}

/**
 * Comprehensive UPnP check for Windows - Now focused only on miniupnpc
 * @returns {Promise<Object>} UPnP check results
 */
async function checkWindowsUPnPComprehensive() {
    logger.info('Starting comprehensive Windows UPnP check');
    
    try {
        // Check if the tool is available
        const toolCheck = await checkWindowsUPnPToolAvailability();
        
        if (toolCheck.available) {
            const result = await checkUPnPWindows();
            logger.info(`Native Windows UPnP check result: ${result.status}`);
            return {
                ...result,
                method: 'native',
                platform: 'windows',
                toolPath: toolCheck.path
            };
        }
        
        // If tool is not available, return a basic result
        logger.info('Native tool unavailable, returning basic result');
        return {
            status: 'UNKNOWN',
            enabled: false,
            error: 'UPnP tool not available',
            details: {
                error: 'UPnP checking tool not found'
            },
            recommendations: [
                'Complete the installation to enable UPnP checking'
            ],
            method: 'none',
            platform: 'windows',
            nativeToolAvailable: false
        };
    } catch (error) {
        logger.error(`Comprehensive Windows UPnP check error: ${error.message}`, { stack: error.stack });
        return {
            status: 'FAIL',
            enabled: false,
            error: error.message,
            details: {
                error: 'Unexpected error during UPnP check'
            },
            platform: 'windows'
        };
    }
}

module.exports = {
    checkUPnP: checkUPnPWindows,
    checkUPnPComprehensive: checkWindowsUPnPComprehensive,
    checkPartitionStyle: checkWindowsPartitionStyle,
    isUPnPToolAvailable: checkWindowsUPnPToolAvailability,
    getExternalIpWithUpnpc
};