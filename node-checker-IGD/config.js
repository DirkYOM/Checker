// config.js
const path = require('path');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const config = {
    azure: {
        communicationServices: {
            connectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
            senderEmail: process.env.AZURE_SENDER_EMAIL
        }
    },
    // Add other configuration categories as needed
    isDevelopment: process.env.NODE_ENV === 'development'
};

// Validate required configuration
function validateConfig() {
    const requiredVars = [
        ['AZURE_COMMUNICATION_CONNECTION_STRING', config.azure.communicationServices.connectionString],
        ['AZURE_SENDER_EMAIL', config.azure.communicationServices.senderEmail]
    ];

    const missingVars = requiredVars
        .filter(([name, value]) => !value)
        .map(([name]) => name);

    if (missingVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingVars.join(', ')}\n` +
            'Please check your .env file or environment variables.'
        );
    }
}

// Only validate in production to allow easier development
if (process.env.NODE_ENV !== 'development') {
    validateConfig();
}

module.exports = config;