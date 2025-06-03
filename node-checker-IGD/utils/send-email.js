const nodemailer = require('nodemailer');
const logger = require('../logger');
const systemInfo = require('../common/system-info');

/**
 * Sends system information report via email
 * @param {string} recipientEmail - Email address to send report to
 * @param {Object} sysInfo - System information object to include in report
 * @returns {Promise<Object>} Email sending result
 */
async function sendSystemInfoEmail(recipientEmail, sysInfo) {
    logger.info(`Preparing to send system info email to ${recipientEmail}`);
    
    try {
        // Validate email
        if (!isValidEmail(recipientEmail)) {
            logger.warn(`Invalid email address: ${recipientEmail}`);
            return {
                success: false,
                error: 'Invalid email address'
            };
        }
        
        // Format system info for email
        const formattedReport = systemInfo.prepareSystemReport(sysInfo);
        
        // Get hostname for subject line
        const hostname = sysInfo?.os?.hostname || 'unknown-host';
        
        // Create transporter
        const transporter = createTransporter();
        
        // Set up email options
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'system-checker@example.com',
            to: recipientEmail,
            subject: `System Compatibility Report - ${hostname}`,
            text: formattedReport,
            attachments: [
                {
                    filename: `system-report-${hostname}.txt`,
                    content: formattedReport
                }
            ]
        };
        
        // If JSON report is available, attach it too
        if (sysInfo) {
            mailOptions.attachments.push({
                filename: `system-report-${hostname}.json`,
                content: JSON.stringify(sysInfo, null, 2)
            });
        }
        
        logger.info('Sending email...');
        
        // Send mail
        const info = await transporter.sendMail(mailOptions);
        
        logger.info(`Email sent successfully: ${info.messageId}`);
        return {
            success: true,
            messageId: info.messageId
        };
    } catch (error) {
        logger.error(`Error sending email: ${error.message}`, { stack: error.stack });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Creates an email transporter
 * Uses environment variables for configuration
 * @returns {Object} Nodemailer transporter
 */
function createTransporter() {
    logger.debug('Creating email transporter');
    
    // Check for environment variables
    const host = process.env.SMTP_HOST || 'smtp.example.com';
    const port = parseInt(process.env.SMTP_PORT || '587');
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    
    // If credentials are provided, use them
    if (user && pass) {
        logger.debug(`Creating authenticated transporter for ${host}:${port}`);
        return nodemailer.createTransport({
            host,
            port,
            secure,
            auth: {
                user,
                pass
            }
        });
    }
    
    // Otherwise use a mock transport for testing
    logger.warn('No SMTP credentials found, using mock transport (email will not be sent)');
    return {
        sendMail: async (options) => {
            logger.info('MOCK EMAIL SENDING (would send to: ' + options.to + ')');
            logger.debug('Email content:', { subject: options.subject });
            
            // Return a fake message ID
            return { 
                messageId: `mock-email-${Date.now()}@example.com`
            };
        }
    };
}

/**
 * Validates an email address
 * @param {string} email - Email to validate
 * @returns {boolean} True if email is valid
 */
function isValidEmail(email) {
    if (!email) return false;
    
    // Simple regex for basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

module.exports = {
    sendSystemInfoEmail
};