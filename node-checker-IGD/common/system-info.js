const si = require('systeminformation');
const os = require('os');
const logger = require('../logger');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

/**
 * Gets detailed GPU information
 * @returns {Promise<Object>} GPU information
 */
async function getGPUInfo() {
    logger.info('Getting GPU information');
    
    try {
        const gpuData = await si.graphics();
        
        // Format the controllers data
        const controllers = gpuData.controllers.map(controller => ({
            model: controller.model,
            name: controller.name,
            vendor: controller.vendor,
            vram: controller.vram,
            subVendor: controller.subVendor,
            bus: controller.bus,
            driverVersion: controller.driverVersion,
            deviceId: controller.deviceId,
            revision: controller.revision,
        }));
        
        // Check if any NVIDIA GPUs are present
        const hasNvidia = controllers.some(gpu => 
            gpu.vendor && gpu.vendor.toLowerCase().includes('nvidia')
        );
        
        logger.info(`Found ${controllers.length} GPU(s), NVIDIA present: ${hasNvidia}`);
        
        return {
            controllers,
            displays: gpuData.displays,
            hasNvidia,
            primary: controllers.length > 0 ? controllers[0] : null
        };
    } catch (error) {
        logger.error(`Error getting GPU information: ${error.message}`, { stack: error.stack });
        return { 
            error: 'Error getting GPU information',
            message: error.message,
            controllers: []
        };
    }
}

/**
 * Gets detailed OS information
 * @returns {Promise<Object>} OS information
 */
async function getOSInfo() {
    logger.info('Getting OS information');
    
    try {
        const osData = await si.osInfo();
        const cpuData = await si.cpu();
        const memData = await si.mem();
        
        const osInfo = {
            platform: osData.platform,
            distro: osData.distro,
            release: osData.release,
            arch: osData.arch,
            build: osData.build,
            hostname: os.hostname(),
            cpu: {
                manufacturer: cpuData.manufacturer,
                brand: cpuData.brand,
                speed: cpuData.speed,
                cores: cpuData.cores,
                physicalCores: cpuData.physicalCores
            },
            memory: {
                total: memData.total,
                free: memData.free,
                totalFormatted: formatBytes(memData.total),
                freeFormatted: formatBytes(memData.free)
            }
        };
        
        logger.info(`OS: ${osInfo.distro} ${osInfo.release} (${osInfo.arch})`);
        logger.info(`CPU: ${osInfo.cpu.manufacturer} ${osInfo.cpu.brand} with ${osInfo.cpu.cores} cores`);
        logger.info(`Memory: ${osInfo.memory.totalFormatted} total, ${osInfo.memory.freeFormatted} free`);
        
        return osInfo;        
    } catch (error) {
        logger.error(`Error getting OS information: ${error.message}`, { stack: error.stack });
        return { 
            error: 'Error getting OS information',
            message: error.message,
            platform: process.platform,
            arch: process.arch
        };
    }
}

/**
 * Gets network information including interfaces and connectivity
 * @returns {Promise<Object>} Network information
 */
async function getNetworkInfo() {
    logger.info('Getting network information');
    
    try {
        const networkData = await si.networkInterfaces();
        const netConnections = await si.networkConnections();
        const defaultInterface = await getDefaultNetworkInterface();
        
        // Filter for active interfaces
        const activeInterfaces = networkData.filter(iface => 
            iface.operstate === 'up' && !iface.internal
        );
        
        logger.info(`Found ${activeInterfaces.length} active network interfaces`);
        
        // Test internet connectivity
        const hasInternet = await checkInternetConnectivity();
        logger.info(`Internet connectivity: ${hasInternet ? 'Available' : 'Not available'}`);
        
        return {
            interfaces: networkData,
            activeInterfaces,
            defaultInterface,
            connections: netConnections,
            hasInternet
        };
    } catch (error) {
        logger.error(`Error getting network information: ${error.message}`, { stack: error.stack });
        return { 
            error: 'Error getting network information',
            message: error.message,
            interfaces: []
        };
    }
}

/**
 * Attempts to determine the default network interface
 * @returns {Promise<Object>} Default interface info
 */
async function getDefaultNetworkInterface() {
    logger.debug('Getting default network interface');
    
    try {
        if (process.platform === 'win32') {
            // For Windows, use powershell to get routing information
            const { stdout } = await execPromise('powershell "Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -Property InterfaceIndex,InterfaceAlias,NextHop | Format-List"');
            
            // Extract the interface index and alias
            const indexMatch = stdout.match(/InterfaceIndex\s*:\s*(\d+)/);
            const aliasMatch = stdout.match(/InterfaceAlias\s*:\s*(.+?)(\r|\n)/);
            
            if (indexMatch && aliasMatch) {
                const index = indexMatch[1];
                const alias = aliasMatch[1].trim();
                
                // Get the interface details from systeminformation
                const interfaces = await si.networkInterfaces();
                const defaultIface = interfaces.find(iface => 
                    iface.ifaceName === alias || iface.iface === alias
                );
                
                if (defaultIface) {
                    logger.debug(`Default interface: ${defaultIface.iface} (${defaultIface.ifaceName})`);
                    return {
                        ...defaultIface,
                        isDefault: true
                    };
                }
            }
        } else {
            // For Linux/Unix, get the default gateway
            const { stdout } = await execPromise('ip route show default');
            
            // Extract the interface name
            const match = stdout.match(/dev\s+(\S+)/);
            if (match) {
                const ifaceName = match[1];
                
                // Get the interface details from systeminformation
                const interfaces = await si.networkInterfaces();
                const defaultIface = interfaces.find(iface => 
                    iface.iface === ifaceName
                );
                
                if (defaultIface) {
                    logger.debug(`Default interface: ${defaultIface.iface}`);
                    return {
                        ...defaultIface,
                        isDefault: true
                    };
                }
            }
        }
        
        // Fallback: look for the first non-internal interface that's up
        const interfaces = await si.networkInterfaces();
        const fallbackIface = interfaces.find(iface => 
            !iface.internal && iface.operstate === 'up'
        );
        
        if (fallbackIface) {
            logger.debug(`Fallback default interface: ${fallbackIface.iface}`);
            return {
                ...fallbackIface,
                isDefault: true,
                isFallback: true
            };
        }
        
        logger.warn('No default interface could be determined');
        return null;
    } catch (error) {
        logger.error(`Error determining default network interface: ${error.message}`);
        return null;
    }
}

/**
 * Checks if the system has internet connectivity
 * @returns {Promise<boolean>} True if internet connectivity is available
 */
async function checkInternetConnectivity() {
    logger.debug('Checking internet connectivity');
    
    try {
        // Try to make a HTTP request to a reliable server
        const testUrl = 'https://www.google.com';
        
        if (process.platform === 'win32') {
            const { stdout } = await execPromise(`powershell "Test-NetConnection -ComputerName www.google.com -InformationLevel Quiet"`);
            return stdout.trim().toLowerCase() === 'true';
        } else {
            // For Linux/Unix, try curl or wget
            try {
                await execPromise(`curl --silent --head --fail --max-time 5 ${testUrl}`);
                return true;
            } catch (e) {
                try {
                    await execPromise(`wget -q --spider --timeout=5 ${testUrl}`);
                    return true;
                } catch (e2) {
                    return false;
                }
            }
        }
    } catch (error) {
        logger.warn(`Internet connectivity check failed: ${error.message}`);
        return false;
    }
}

/**
 * Gets detailed disk information
 * @returns {Promise<Object>} Disk information
 */
async function getDiskInfo() {
    logger.info('Getting disk information');
    
    try {
        const disks = await si.diskLayout();
        const fsSize = await si.fsSize();
        
        logger.info(`Found ${disks.length} physical disk(s) and ${fsSize.length} partition(s)`);
        
        // Calculate total and free space across all filesystems
        const totalSpace = fsSize.reduce((acc, fs) => acc + fs.size, 0);
        const freeSpace = fsSize.reduce((acc, fs) => acc + fs.available, 0);
        
        return {
            disks,
            filesystems: fsSize,
            totalSpace,
            freeSpace,
            totalSpaceFormatted: formatBytes(totalSpace),
            freeSpaceFormatted: formatBytes(freeSpace)
        };
    } catch (error) {
        logger.error(`Error getting disk information: ${error.message}`, { stack: error.stack });
        return { 
            error: 'Error getting disk information',
            message: error.message,
            disks: [],
            filesystems: []
        };
    }
}

/**
 * Checks if the system meets compatibility requirements
 * @param {Object} osInfo - OS information object
 * @param {Object} gpuInfo - GPU information object
 * @param {Object} networkInfo - Network information object
 * @param {Object} diskInfo - Disk information object
 * @returns {Object} Compatibility assessment
 */
function assessCompatibility(osInfo, gpuInfo, networkInfo, diskInfo) {
    logger.info('Assessing system compatibility');
    
    const compatibility = {
        compatible: true,
        requirements: [],
        recommendations: [],
        warnings: []
    };
    
    // Check for NVIDIA GPU (requirement)
    if (!gpuInfo.hasNvidia) {
        compatibility.compatible = false;
        compatibility.requirements.push({
            name: 'NVIDIA GPU',
            met: false,
            description: 'An NVIDIA GPU is required',
            current: gpuInfo.primary ? gpuInfo.primary.vendor : 'No GPU detected'
        });
    } else {
        compatibility.requirements.push({
            name: 'NVIDIA GPU',
            met: true,
            description: 'An NVIDIA GPU is required',
            current: gpuInfo.primary ? gpuInfo.primary.model : 'Unknown NVIDIA model'
        });
    }
    
    // Check for minimum memory (4GB)
    const minMemory = 4 * 1024 * 1024 * 1024; // 4GB in bytes
    const memoryMet = osInfo.memory && osInfo.memory.total >= minMemory;
    
    compatibility.requirements.push({
        name: 'System Memory',
        met: memoryMet,
        description: 'Minimum 4GB RAM required',
        current: osInfo.memory ? osInfo.memory.totalFormatted : 'Unknown'
    });
    
    if (!memoryMet) {
        compatibility.compatible = false;
    }
    
    // Check for internet connectivity
    if (!networkInfo.hasInternet) {
        compatibility.warnings.push({
            name: 'Internet Connectivity',
            description: 'Internet connection is recommended for updates and online features',
            current: 'No internet connection detected'
        });
    }
    
    // Check for minimum disk space (10GB free)
    const minDiskSpace = 10 * 1024 * 1024 * 1024; // 10GB in bytes
    const diskSpaceMet = diskInfo.freeSpace >= minDiskSpace;
    
    compatibility.requirements.push({
        name: 'Free Disk Space',
        met: diskSpaceMet,
        description: 'Minimum 10GB free disk space required',
        current: diskInfo.freeSpaceFormatted
    });
    
    if (!diskSpaceMet) {
        compatibility.compatible = false;
    }
    
    // OS compatibility
    let osCompatible = false;
    
    if (process.platform === 'win32') {
        // Check for Windows 10 or later
        osCompatible = osInfo.release && (
            osInfo.release.startsWith('10.') || 
            parseInt(osInfo.release.split('.')[0]) > 10
        );
        
        compatibility.requirements.push({
            name: 'Operating System',
            met: osCompatible,
            description: 'Windows 10 or later required',
            current: osInfo.distro
        });
    } else if (process.platform === 'linux') {
        // Check for Ubuntu or compatible distribution
        osCompatible = osInfo.distro && (
            osInfo.distro.toLowerCase().includes('ubuntu') ||
            osInfo.distro.toLowerCase().includes('debian')
        );
        
        compatibility.requirements.push({
            name: 'Operating System',
            met: osCompatible,
            description: 'Ubuntu or Debian-based Linux required',
            current: osInfo.distro
        });
    } else {
        osCompatible = false;
        compatibility.requirements.push({
            name: 'Operating System',
            met: false,
            description: 'Windows 10+ or Ubuntu/Debian Linux required',
            current: osInfo.platform
        });
    }
    
    if (!osCompatible) {
        compatibility.compatible = false;
    }
    
    logger.info(`Compatibility assessment complete. System is ${compatibility.compatible ? 'compatible' : 'not compatible'}`);
    return compatibility;
}

/**
 * Formats bytes to a human-readable string
 * @param {number} bytes - Bytes to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Gets comprehensive system information
 * @returns {Promise<Object>} Complete system information
 */
async function getSystemInfo() {
    logger.info('Getting comprehensive system information');
    
    try {
        // Run all checks in parallel
        const [osInfo, gpuInfo, networkInfo, diskInfo] = await Promise.all([
            getOSInfo(),
            getGPUInfo(),
            getNetworkInfo(),
            getDiskInfo()
        ]);
        
        // Create the report
        const report = {
            timestamp: new Date().toISOString(),
            os: osInfo,
            gpu: gpuInfo,
            network: networkInfo,
            disk: diskInfo,
            compatibility: assessCompatibility(osInfo, gpuInfo, networkInfo, diskInfo)
        };
        
        logger.info('System information collection completed');
        return report;
    } catch (error) {
        logger.error(`Error getting system information: ${error.message}`, { stack: error.stack });
        return { 
            error: 'Error collecting system information',
            message: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Prepares an email-friendly report from system information
 * @param {Object} sysInfo - System information object 
 * @returns {string} Formatted report for email
 */
function prepareSystemReport(sysInfo) {
    if (!sysInfo) return 'Error: No system information available';
    
    let report = '=== SYSTEM COMPATIBILITY REPORT ===\n\n';
    
    // Add timestamp
    report += `Report Generated: ${new Date(sysInfo.timestamp).toLocaleString()}\n\n`;
    
    // Overall compatibility
    if (sysInfo.compatibility) {
        report += `OVERALL COMPATIBILITY: ${sysInfo.compatibility.compatible ? 'COMPATIBLE' : 'NOT COMPATIBLE'}\n\n`;
    }
    
    // OS Information
    report += '--- OPERATING SYSTEM ---\n';
    if (sysInfo.os) {
        report += `OS: ${sysInfo.os.distro} ${sysInfo.os.release} (${sysInfo.os.arch})\n`;
        report += `Hostname: ${sysInfo.os.hostname}\n`;
        if (sysInfo.os.cpu) {
            report += `CPU: ${sysInfo.os.cpu.manufacturer} ${sysInfo.os.cpu.brand}, ${sysInfo.os.cpu.cores} cores\n`;
        }
        if (sysInfo.os.memory) {
            report += `Memory: ${sysInfo.os.memory.totalFormatted} total, ${sysInfo.os.memory.freeFormatted} free\n`;
        }
    } else {
        report += 'OS Information: Not available\n';
    }
    report += '\n';
    
    // GPU Information
    report += '--- GPU ---\n';
    if (sysInfo.gpu && sysInfo.gpu.controllers && sysInfo.gpu.controllers.length > 0) {
        report += `NVIDIA GPU Present: ${sysInfo.gpu.hasNvidia ? 'Yes' : 'No'}\n`;
        sysInfo.gpu.controllers.forEach((gpu, index) => {
            report += `GPU ${index + 1}: ${gpu.model || gpu.name || 'Unknown'}\n`;
            report += `  Vendor: ${gpu.vendor || 'Unknown'}\n`;
            if (gpu.vram) report += `  VRAM: ${formatBytes(gpu.vram)}\n`;
            if (gpu.driverVersion) report += `  Driver: ${gpu.driverVersion}\n`;
        });
    } else {
        report += 'GPU Information: Not available\n';
    }
    report += '\n';
    
    // Network Information
    report += '--- NETWORK ---\n';
    if (sysInfo.network) {
        report += `Internet Connectivity: ${sysInfo.network.hasInternet ? 'Available' : 'Not Available'}\n`;
        if (sysInfo.network.defaultInterface) {
            const iface = sysInfo.network.defaultInterface;
            report += `Default Interface: ${iface.iface} (${iface.ifaceName || 'Unknown'})\n`;
            report += `  IP Address: ${iface.ip4 || 'Unknown'}\n`;
            report += `  MAC Address: ${iface.mac || 'Unknown'}\n`;
            report += `  Speed: ${iface.speed || 'Unknown'} Mbps\n`;
        }
        report += `Active Network Interfaces: ${sysInfo.network.activeInterfaces ? sysInfo.network.activeInterfaces.length : 0}\n`;
    } else {
        report += 'Network Information: Not available\n';
    }
    report += '\n';
    
    // Disk Information
    report += '--- STORAGE ---\n';
    if (sysInfo.disk) {
        report += `Total Disk Space: ${sysInfo.disk.totalSpaceFormatted}\n`;
        report += `Free Disk Space: ${sysInfo.disk.freeSpaceFormatted}\n`;
        if (sysInfo.disk.disks && sysInfo.disk.disks.length > 0) {
            report += `Physical Disks: ${sysInfo.disk.disks.length}\n`;
            sysInfo.disk.disks.forEach((disk, index) => {
                report += `  Disk ${index + 1}: ${disk.name || 'Unknown'} (${formatBytes(disk.size)})\n`;
                if (disk.type) report += `    Type: ${disk.type}\n`;
                if (disk.vendor) report += `    Vendor: ${disk.vendor}\n`;
            });
        }
    } else {
        report += 'Disk Information: Not available\n';
    }
    report += '\n';
    
    // Compatibility Requirements
    report += '--- COMPATIBILITY REQUIREMENTS ---\n';
    if (sysInfo.compatibility && sysInfo.compatibility.requirements) {
        sysInfo.compatibility.requirements.forEach(req => {
            report += `${req.name}: ${req.met ? 'PASS' : 'FAIL'}\n`;
            report += `  Required: ${req.description}\n`;
            report += `  Current: ${req.current}\n`;
        });
    } else {
        report += 'Compatibility Information: Not available\n';
    }
    
    // Warnings
    if (sysInfo.compatibility && sysInfo.compatibility.warnings && sysInfo.compatibility.warnings.length > 0) {
        report += '\n--- WARNINGS ---\n';
        sysInfo.compatibility.warnings.forEach(warning => {
            report += `${warning.name}: ${warning.description}\n`;
            if (warning.current) report += `  Current: ${warning.current}\n`;
        });
    }
    
    report += '\n=== END OF REPORT ===\n';
    return report;
}

module.exports = {
    getGPUInfo,
    getOSInfo,
    getNetworkInfo,
    getDiskInfo,
    getSystemInfo,
    prepareSystemReport,
    formatBytes
};