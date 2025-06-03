const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const fs = require('fs');
const os = require('os');
const natUpnp = require('nat-upnp');
const logger = require('../logger');
const commandExists = require('command-exists').sync;

/**
 * Checks if UPnP tool is available on Linux
 * @returns {Promise<boolean>} True if upnpc is available
 */
async function checkLinuxUPnPToolAvailability() {
    logger.info('Checking if UPnP tool is available on Linux');
    
    // Check if miniupnpc is installed on Linux
    try {
        const hasUpnpc = commandExists('upnpc');
        if (hasUpnpc) {
            logger.info('upnpc is already installed');
            return true;
        }
    } catch (err) {
        // Not installed, try to install it
        logger.warn('upnpc not found, attempting to install');
        
        try {
            // Try to detect the Linux distribution
            const { stdout: lsbOutput } = await execPromise('lsb_release -a || cat /etc/os-release');
            logger.debug(`Distribution info: ${lsbOutput}`);
            
            if (lsbOutput.toLowerCase().includes('ubuntu') || 
                lsbOutput.toLowerCase().includes('debian')) {
                // For Ubuntu/Debian
                logger.info('Detected Ubuntu/Debian, using apt');
                
                // Note: This requires sudo permissions
                logger.debug('Running: sudo apt-get update && sudo apt-get install -y miniupnpc');
                await execPromise('sudo apt-get update && sudo apt-get install -y miniupnpc');
                
                // Verify installation
                try {
                    await execPromise('which upnpc');
                    logger.info('upnpc successfully installed');
                    return true;
                } catch (e) {
                    logger.error(`Installation verification failed: ${e.message}`);
                    return false;
                }
            } else if (lsbOutput.toLowerCase().includes('fedora') || 
                       lsbOutput.toLowerCase().includes('centos') || 
                       lsbOutput.toLowerCase().includes('rhel')) {
                // For Fedora/CentOS/RHEL
                logger.info('Detected Fedora/CentOS/RHEL, using dnf/yum');
                
                // Try dnf first (newer), fall back to yum
                try {
                    await execPromise('which dnf');
                    logger.debug('Running: sudo dnf install -y miniupnpc');
                    await execPromise('sudo dnf install -y miniupnpc');
                } catch (e) {
                    logger.warn('DNF not found or failed, trying yum');
                    await execPromise('sudo yum install -y miniupnpc');
                }
                
                // Verify installation
                try {
                    await execPromise('which upnpc');
                    logger.info('upnpc successfully installed');
                    return true;
                } catch (e) {
                    logger.error(`Installation verification failed: ${e.message}`);
                    return false;
                }
            } else {
                logger.warn('Unsupported Linux distribution, cannot auto-install');
                return false;
            }
        } catch (error) {
            logger.error(`Failed to install upnpc: ${error.message}`);
            return false;
        }
    }
    
    return false;
}

/**
 * Check UPnP using Linux-specific tools
 * @returns {Promise<Object>} UPnP status object
 */
async function checkUPnPLinux() {
    logger.info('Linux UPnP check started');
    
    const result = {
        igdDetected: false,
        addMapping: false,
        removeMapping: false,
        status: 'FAIL',
        details: {},
        recommendations: [],
        platform: 'linux'
    };
    
    try {
        // Step 1: Check for IGD presence with -i flag for interactive 
        logger.debug('Running upnpc -i -l command');
        const { stdout: listOutput } = await execPromise('upnpc -i -l');
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
        logger.info('IGD UPnP Device found');
        
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
        
        // Step 2: Try to add a test mapping with -i flag
        const testPort = 8080; // Using 8080 as specified in original code
        try {
            const addCommand = `upnpc -i -a ${localIp} ${testPort} ${testPort} TCP`;
            logger.debug(`Running add port mapping command: ${addCommand}`);
            
            const { stdout: addOutput } = await execPromise(addCommand);
            
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
        
        // Step 3: Try to remove the test mapping with -i flag
        try {
            const removeCommand = `upnpc -i -d ${testPort} TCP`;
            logger.debug(`Running remove port mapping command: ${removeCommand}`);
            
            const { stdout: removeOutput } = await execPromise(removeCommand);
            
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
            logger.info('UPnP check passed successfully');
        } else if (result.igdDetected && (result.addMapping || result.removeMapping)) {
            result.status = 'PARTIAL_PASS';
            result.recommendations.push("Additional Router settings required");
            logger.info('UPnP check partially passed');
        } else {
            result.status = 'FAIL';
            if (result.igdDetected) {
                result.recommendations.push("UPnP is detected but port mapping operations failed. Check router settings.");
                logger.warn('UPnP device detected but operations failed');
            } else {
                logger.warn('UPnP check failed completely');
            }
        }
        
        logger.info(`Linux UPnP final result: ${result.status}`);
        return result;
    } catch (error) {
        logger.error(`Linux UPnP check error: ${error.message}`, { stack: error.stack });
        result.details.error = error.message;
        return result;
    }
}

/**
 * UPnP check using the nat-upnp library for Linux
 * @returns {Promise<Object>} UPnP status object
 */
async function checkUPnPWithLibraryLinux() {
    logger.info('Linux Library UPnP check started');
    
    let client;
    const result = {
        igdDetected: false,
        addMapping: false,
        removeMapping: false,
        status: 'FAIL',
        details: {},
        recommendations: [],
        platform: 'linux'
    };
    
    try {
        // Create UPnP client
        client = natUpnp.createClient();
        logger.debug('UPnP client created');
        
        // Step 1: Check for IGD presence
        const externalIp = await new Promise((resolve) => {
            client.externalIp((err, ip) => {
                if (err || !ip) {
                    logger.warn(`External IP check failed: ${err ? err.message : 'No IP returned'}`);
                    resolve(null);
                } else {
                    logger.debug(`External IP found: ${ip}`);
                    resolve(ip);
                }
            });
        });
        
        if (!externalIp) {
            result.details.error = "No IGD detected on the network";
            result.recommendations.push("Check if your router supports UPnP and make sure it's enabled");
            logger.warn('No IGD detected on the network');
            if (client) client.close();
            return result;
        }
        
        result.igdDetected = true;
        result.details.externalIp = externalIp;
        logger.info(`IGD detected with external IP: ${externalIp}`);
        
        // Step 2: Try to add a test mapping
        const testPort = 44444; // An uncommon port for testing
        const addMappingResult = await new Promise((resolve) => {
            client.createMapping({
                public: testPort,
                private: testPort,
                ttl: 0,
                description: 'UPnP Test'
            }, (err) => {
                if (err) {
                    logger.warn(`Add mapping failed: ${err.message}`);
                    resolve(false);
                } else {
                    logger.debug(`Add mapping succeeded for port ${testPort}`);
                    resolve(true);
                }
            });
        });
        
        result.addMapping = addMappingResult;
        logger.info(`Add mapping result: ${addMappingResult}`);
        
        // Step 3: Try to remove the test mapping
        const removeMappingResult = await new Promise((resolve) => {
            client.removeMapping({
                public: testPort
            }, (err) => {
                if (err) {
                    logger.warn(`Remove mapping failed: ${err.message}`);
                    resolve(false);
                } else {
                    logger.debug(`Remove mapping succeeded for port ${testPort}`);
                    resolve(true);
                }
            });
        });
        
        result.removeMapping = removeMappingResult;
        logger.info(`Remove mapping result: ${removeMappingResult}`);
        
        // Determine scenario based on results
        if (result.igdDetected && result.addMapping && result.removeMapping) {
            result.status = 'PASS';
            logger.info('UPnP library check passed successfully');
        } else if (result.igdDetected && (result.addMapping || result.removeMapping)) {
            result.status = 'PARTIAL_PASS';
            result.recommendations.push("Additional Router settings required");
            logger.info('UPnP library check partially passed');
        } else {
            result.status = 'FAIL';
            if (result.igdDetected) {
                result.recommendations.push("UPnP is detected but port mapping operations failed. Check router settings.");
                logger.warn('UPnP device detected but operations failed');
            }
        }
        
        logger.info(`UPnP library check final result: ${result.status}`);
        return result;
    } catch (error) {
        logger.error(`UPnP library check error: ${error.message}`, { stack: error.stack });
        result.details.error = error.message;
        return result;
    } finally {
        if (client) client.close();
    }
}

/**
 * Check disk partition style on Linux
 * @returns {Promise<Object>} Partition information
 */
async function checkLinuxPartitionStyle() {
    logger.info('Checking Linux partition style');
    
    try {
        // Linux-specific command
        const { stdout } = await execPromise('lsblk -o NAME,PTTYPE');
        logger.debug(`Partition style raw output: ${stdout}`);
        
        logger.info('Successfully retrieved Linux partition information');
        return { 
            style: stdout, 
            platform: 'linux',
            formatted: formatLinuxPartitionOutput(stdout)
        };
    } catch (error) {
        logger.warn(`First Linux partition command failed: ${error.message}, trying alternative`);
        
        // Try alternative command if first fails
        try {
            const { stdout: stdout2 } = await execPromise('fdisk -l | grep "Disklabel type:"');
            logger.debug(`Alternative partition style output: ${stdout2}`);
            
            logger.info('Successfully retrieved Linux partition information via alternative method');
            return { 
                style: stdout2, 
                platform: 'linux',
                formatted: formatLinuxPartitionOutput(stdout2, true)
            };
        } catch (error2) {
            logger.error(`Error reading Linux partition information: ${error2.message}`);
            return { 
                error: 'Error reading Linux partition information', 
                details: error2.message,
                platform: 'linux'
            };
        }
    }
}

/**
 * Helper function to format Linux partition output
 * @param {string} output - Raw output from lsblk or fdisk
 * @param {boolean} isFdisk - Whether the output is from fdisk
 * @returns {Array<Object>|null} Formatted partition information
 */
function formatLinuxPartitionOutput(output, isFdisk = false) {
    try {
        if (isFdisk) {
            // Format fdisk output
            const lines = output.split('\n').filter(line => line.trim());
            return lines.map(line => {
                const match = line.match(/Disklabel type:\s*(.+)/);
                return match ? { disk: 'unknown', type: match[1].trim() } : null;
            }).filter(item => item !== null);
        } else {
            // Format lsblk output
            const lines = output.split('\n').filter(line => line.trim());
            // Skip header line
            const dataLines = lines.slice(1);
            return dataLines.map(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    return {
                        disk: parts[0],
                        type: parts[1] || 'unknown'
                    };
                }
                return null;
            }).filter(item => item !== null);
        }
    } catch (error) {
        logger.error(`Error formatting Linux partition output: ${error.message}`);
        return null;
    }
}

/**
 * Comprehensive UPnP check for Linux
 * Combines both library and native tool approaches
 * @returns {Promise<Object>} Combined UPnP check results
 */
async function checkLinuxUPnPComprehensive() {
    logger.info('Starting comprehensive Linux UPnP check');
    
    try {
        // First try library-based approach
        const libraryResult = await checkUPnPWithLibraryLinux();
        logger.info(`Library UPnP check result: ${libraryResult.status}`);
        
        // Try Linux-specific approach if available
        const isToolAvailable = await checkLinuxUPnPToolAvailability();
        
        if (isToolAvailable) {
            const nativeResult = await checkUPnPLinux();
            logger.info(`Native Linux UPnP check result: ${nativeResult.status}`);
            
            // Combine results, preferring native tool results when available
            const result = {
                ...libraryResult,
                ...nativeResult,
                method: 'native',
                libraryFallbackAvailable: true,
                platform: 'linux'
            };
            
            logger.info('Returning combined UPnP check results');
            return result;
        }
        
        // Return library results if native tool is not available
        logger.info('Native tool unavailable, returning library results only');
        return {
            ...libraryResult,
            method: 'library',
            nativeToolAvailable: false,
            platform: 'linux'
        };
    } catch (error) {
        logger.error(`Comprehensive Linux UPnP check error: ${error.message}`, { stack: error.stack });
        return {
            status: 'FAIL',
            error: error.message,
            details: 'Unexpected error during UPnP check',
            platform: 'linux'
        };
    }
}

module.exports = {
    checkUPnP: checkUPnPLinux,
    checkUPnPComprehensive: checkLinuxUPnPComprehensive,
    checkUPnPWithLibrary: checkUPnPWithLibraryLinux,
    checkPartitionStyle: checkLinuxPartitionStyle,
    isUPnPToolAvailable: checkLinuxUPnPToolAvailability
};