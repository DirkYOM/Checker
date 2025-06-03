const winston = require('winston');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const os = require('os');

// Create logs directory if it doesn't exist
let logsDir;
try {
    // Handle the case where app might not be fully initialized
    logsDir = path.join(app.getPath('userData'), 'logs');
} catch (error) {
    // Fallback to temp directory if app is not ready
    logsDir = path.join(os.tmpdir(), 'system-checker-logs');
}

if (!fs.existsSync(logsDir)) {
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (error) {
        console.error(`Failed to create logs directory: ${error.message}`);
    }
}

// Define timestamp format
const timestampFormat = winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
});

// Define log formats
const consoleFormat = winston.format.combine(
    timestampFormat,
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let metaStr = '';
        if (Object.keys(metadata).length > 0) {
            metaStr = ` ${JSON.stringify(metadata)}`;
        }
        return `${timestamp} ${level}: ${message}${metaStr}`;
    })
);

const fileFormat = winston.format.combine(
    timestampFormat,
    winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    defaultMeta: { 
        platform: process.platform,
        arch: process.arch,
        pid: process.pid
    },
    transports: [
        // Console output
        new winston.transports.Console({
            format: consoleFormat
        }),
        // Log to files
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // Installation log file
        new winston.transports.File({
            filename: path.join(logsDir, 'installation.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        })
    ],
    // Don't exit on error
    exitOnError: false
});

// Add platform info to log context
logger.addPlatformContext = function() {
    const platformContext = {
        platform: process.platform,
        osType: os.type(),
        osRelease: os.release(),
        hostname: os.hostname()
    };
    
    this.defaultMeta = {
        ...this.defaultMeta,
        ...platformContext
    };
    
    return platformContext;
};

// Add application info to log context
logger.addAppContext = function(appInfo) {
    this.defaultMeta = {
        ...this.defaultMeta,
        ...appInfo
    };
};

// Log startup information
logger.logStartup = function() {
    const platformInfo = this.addPlatformContext();
    
    this.info('=== System Checker Application Started ===');
    this.info(`Platform: ${platformInfo.platform} (${platformInfo.osType} ${platformInfo.osRelease})`);
    this.info(`Hostname: ${platformInfo.hostname}`);
    this.info(`Process ID: ${process.pid}`);
    this.info(`Node.js Version: ${process.version}`);
    this.info(`Electron Version: ${process.versions.electron || 'unknown'}`);
    this.info(`Log Directory: ${logsDir}`);
    this.info('==========================================');
};

// Log installation events
logger.logInstallation = function(details) {
    this.info('=== YOM Node Inspector Installation Event ===');
    this.info(`Event Type: ${details.event || 'unknown'}`);
    this.info(`Installation Path: ${details.installPath || 'unknown'}`);
    this.info(`Timestamp: ${new Date().toISOString()}`);
    
    if (details.desktopShortcut) {
        this.info(`Desktop Shortcut: ${details.desktopShortcut}`);
    }
    
    if (details.startMenuShortcut) {
        this.info(`Start Menu Shortcut: ${details.startMenuShortcut}`);
    }
    
    if (details.error) {
        this.error(`Installation Error: ${details.error}`);
    }
    
    this.info('============================================');
    
    return true;
};

// Optional: Create a child logger with component context
logger.createComponentLogger = function(component) {
    return this.child({ component });
};

// Uncaught exception handler
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { 
        error: { 
            message: error.message,
            stack: error.stack,
            name: error.name
        }
    });
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', { 
        reason: reason instanceof Error ? { 
            message: reason.message,
            stack: reason.stack,
            name: reason.name
        } : reason
    });
});

// Log startup information on require
logger.logStartup();

module.exports = logger;