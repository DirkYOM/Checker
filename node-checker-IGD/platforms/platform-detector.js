const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);
const logger = require('../logger');

/**
 * Detects the platform and provides detailed platform information
 * @returns {Object} Platform information object
 */
function detectPlatform() {
    const platformInfo = {
        isWindows: process.platform === 'win32',
        isLinux: process.platform === 'linux',
        isMac: process.platform === 'darwin',
        isUbuntu: false,
        platform: process.platform,
        osDetails: os.type() + ' ' + os.release(),
        arch: os.arch(),
        cpuCores: os.cpus().length,
        totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB'
    };
    
    logger.info(`Platform detected: ${platformInfo.platform} (${platformInfo.osDetails})`);
    logger.info(`Architecture: ${platformInfo.arch}, CPU Cores: ${platformInfo.cpuCores}, Memory: ${platformInfo.totalMemory}`);
    
    return platformInfo;
}

/**
 * Detects the platform with more detailed Linux distribution information
 * This is an async version that can determine Linux distribution type
 * @returns {Promise<Object>} Enhanced platform information object
 */
async function detectPlatformDetailed() {
    const basicInfo = detectPlatform();
    
    // For Linux, get more detailed distribution info
    if (basicInfo.isLinux) {
        try {
            const distroInfo = await getLinuxDistributionInfo();
            return {
                ...basicInfo,
                ...distroInfo
            };
        } catch (error) {
            logger.error(`Error detecting Linux distribution: ${error.message}`);
            return basicInfo;
        }
    }
    
    // For Windows, get version information
    if (basicInfo.isWindows) {
        try {
            const windowsInfo = await getWindowsVersionInfo();
            return {
                ...basicInfo,
                ...windowsInfo
            };
        } catch (error) {
            logger.error(`Error detecting Windows version: ${error.message}`);
            return basicInfo;
        }
    }
    
    return basicInfo;
}

/**
 * Gets detailed information about Linux distribution
 * @returns {Promise<Object>} Linux distribution details
 */
async function getLinuxDistributionInfo() {
    logger.debug('Checking Linux distribution details');
    
    try {
        // Try to get distribution info from os-release
        const { stdout: osReleaseOutput } = await execPromise('cat /etc/os-release');
        
        // Parse os-release content
        const distroInfo = {
            isUbuntu: false,
            isDebian: false,
            isFedora: false,
            isCentOS: false,
            isRHEL: false,
            distroName: '',
            distroVersion: '',
            distroId: ''
        };
        
        // Extract information from os-release
        const lines = osReleaseOutput.split('\n');
        for (const line of lines) {
            if (line.startsWith('NAME=')) {
                distroInfo.distroName = line.substring(5).replace(/"/g, '').trim();
            } else if (line.startsWith('VERSION_ID=')) {
                distroInfo.distroVersion = line.substring(11).replace(/"/g, '').trim();
            } else if (line.startsWith('ID=')) {
                distroInfo.distroId = line.substring(3).replace(/"/g, '').trim();
            }
        }
        
        // Set distribution flags
        const lowerDistroName = distroInfo.distroName.toLowerCase();
        const lowerDistroId = distroInfo.distroId.toLowerCase();
        
        distroInfo.isUbuntu = lowerDistroId.includes('ubuntu') || lowerDistroName.includes('ubuntu');
        distroInfo.isDebian = lowerDistroId.includes('debian') || lowerDistroName.includes('debian');
        distroInfo.isFedora = lowerDistroId.includes('fedora') || lowerDistroName.includes('fedora');
        distroInfo.isCentOS = lowerDistroId.includes('centos') || lowerDistroName.includes('centos');
        distroInfo.isRHEL = lowerDistroId.includes('rhel') || lowerDistroName.includes('red hat');
        
        logger.info(`Linux distribution: ${distroInfo.distroName} ${distroInfo.distroVersion}`);
        logger.debug(`Distribution ID: ${distroInfo.distroId}`);
        
        return distroInfo;
    } catch (error) {
        logger.error(`Error reading Linux distribution information: ${error.message}`);
        
        // Try lsb_release as a fallback
        try {
            const { stdout: lsbOutput } = await execPromise('lsb_release -a');
            
            const distroInfo = {
                isUbuntu: lsbOutput.toLowerCase().includes('ubuntu'),
                isDebian: lsbOutput.toLowerCase().includes('debian'),
                isFedora: lsbOutput.toLowerCase().includes('fedora'),
                isCentOS: lsbOutput.toLowerCase().includes('centos'),
                isRHEL: lsbOutput.toLowerCase().includes('red hat'),
                distroName: '',
                distroVersion: '',
                distroId: ''
            };
            
            // Extract information from lsb_release output
            const lines = lsbOutput.split('\n');
            for (const line of lines) {
                if (line.startsWith('Distributor ID:')) {
                    distroInfo.distroId = line.substring(15).trim();
                    distroInfo.distroName = distroInfo.distroId;
                } else if (line.startsWith('Release:')) {
                    distroInfo.distroVersion = line.substring(8).trim();
                }
            }
            
            logger.info(`Linux distribution (from lsb_release): ${distroInfo.distroName} ${distroInfo.distroVersion}`);
            return distroInfo;
        } catch (lsbError) {
            logger.error(`Error using lsb_release as fallback: ${lsbError.message}`);
            return {
                isUbuntu: false,
                isDebian: false,
                isFedora: false,
                isCentOS: false,
                isRHEL: false,
                distroName: 'Unknown Linux',
                distroVersion: '',
                distroId: 'linux'
            };
        }
    }
}

/**
 * Gets detailed information about Windows version
 * @returns {Promise<Object>} Windows version details
 */
async function getWindowsVersionInfo() {
    logger.debug('Checking Windows version details');
    
    try {
        const { stdout } = await execPromise('powershell "Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsHardwareAbstractionLayer"');
        
        const windowsInfo = {
            windowsProductName: '',
            windowsVersion: '',
            isWindows10: false,
            isWindows11: false,
            isWindows8: false,
            isWindows7: false,
            isWindowsServer: false
        };
        
        // Parse PowerShell output
        const lines = stdout.split('\n').filter(line => line.trim());
        for (const line of lines) {
            if (line.includes('WindowsProductName')) {
                windowsInfo.windowsProductName = line.split(':')[1]?.trim() || '';
            } else if (line.includes('WindowsVersion')) {
                windowsInfo.windowsVersion = line.split(':')[1]?.trim() || '';
            }
        }
        
        // Set Windows version flags
        const productName = windowsInfo.windowsProductName.toLowerCase();
        windowsInfo.isWindows11 = productName.includes('windows 11');
        windowsInfo.isWindows10 = productName.includes('windows 10');
        windowsInfo.isWindows8 = productName.includes('windows 8');
        windowsInfo.isWindows7 = productName.includes('windows 7');
        windowsInfo.isWindowsServer = productName.includes('server');
        
        logger.info(`Windows version: ${windowsInfo.windowsProductName} (${windowsInfo.windowsVersion})`);
        
        return windowsInfo;
    } catch (error) {
        logger.error(`Error detecting Windows version: ${error.message}`);
        
        // Fallback to using os.release() to make an educated guess
        const release = os.release();
        const windowsInfo = {
            windowsProductName: 'Windows',
            windowsVersion: release,
            isWindows10: false,
            isWindows11: false,
            isWindows8: false,
            isWindows7: false,
            isWindowsServer: false
        };
        
        // Windows 11 and Windows 10 share the same version number pattern (10.0.x)
        // Windows 11 is 10.0.22000 or higher
        if (release.startsWith('10.0.')) {
            const buildNumber = parseInt(release.split('.')[2]);
            if (buildNumber >= 22000) {
                windowsInfo.isWindows11 = true;
                windowsInfo.windowsProductName = 'Windows 11';
            } else {
                windowsInfo.isWindows10 = true;
                windowsInfo.windowsProductName = 'Windows 10';
            }
        } else if (release.startsWith('6.3.')) {
            windowsInfo.isWindows8 = true;
            windowsInfo.windowsProductName = 'Windows 8.1';
        } else if (release.startsWith('6.2.')) {
            windowsInfo.isWindows8 = true;
            windowsInfo.windowsProductName = 'Windows 8';
        } else if (release.startsWith('6.1.')) {
            windowsInfo.isWindows7 = true;
            windowsInfo.windowsProductName = 'Windows 7';
        }
        
        logger.info(`Windows version (fallback): ${windowsInfo.windowsProductName} (${windowsInfo.windowsVersion})`);
        return windowsInfo;
    }
}

module.exports = {
    detectPlatform,
    detectPlatformDetailed
};