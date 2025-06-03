// node-checker-IGD/common/traceroute.js
const Traceroute = require('nodejs-traceroute');
const logger = require('../logger'); // Assuming logger is accessible like this

/**
 * Performs a traceroute to the given host.
 * @param {string} host - The hostname or IP address to trace.
 * @param {object} callbacks - An object containing callback functions.
 * @param {function(pid: number)} callbacks.onPid - Called with the process ID.
 * @param {function(destination: string)} callbacks.onDestination - Called with the resolved destination IP.
 * @param {function(hop: object)} callbacks.onHop - Called for each hop.
 *        Hop object example: { hop: 1, ip: "1.2.3.4", rtt1: "10.0 ms" }
 * @param {function(code: number)} callbacks.onClose - Called when the traceroute process closes.
 * @param {function(error: Error)} callbacks.onError - Called if an error occurs during setup or execution.
 */
function performTraceroute(host, callbacks) {
  try {
    const tracer = new Traceroute();

    tracer
      .on('pid', (pid) => {
        logger.info(`Traceroute PID: ${pid} for host: ${host}`);
        if (callbacks.onPid) callbacks.onPid(pid);
      })
      .on('destination', (destination) => {
        logger.info(`Traceroute destination: ${destination} for host: ${host}`);
        if (callbacks.onDestination) callbacks.onDestination(destination);
      })
      .on('hop', (hop) => {
        // hop object might be like: { hop: 1, ip: '192.168.1.1', rtt1: '1.234 ms' }
        // or { hop: 2, ip: '*', rtt1: '*' } for timeouts
        logger.debug(`Traceroute hop for ${host}: ${JSON.stringify(hop)}`);
        if (callbacks.onHop) callbacks.onHop(hop);
      })
      .on('close', (code) => {
        logger.info(`Traceroute process for ${host} closed with code: ${code}`);
        if (callbacks.onClose) callbacks.onClose(code);
      })
      .on('error', (err) => { // Added listener for 'error' event from tracer object
        logger.error(`Traceroute error for host ${host}: ${err.message}`, err);
        if (callbacks.onError) callbacks.onError(err);
      });

    logger.info(`Starting traceroute to: ${host}`);
    tracer.trace(host);

  } catch (ex) {
    logger.error(`Failed to initiate traceroute for ${host}: ${ex.message}`, ex);
    if (callbacks.onError) callbacks.onError(ex);
  }
}

module.exports = {
  performTraceroute,
};
