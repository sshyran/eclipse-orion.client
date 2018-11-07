/*******************************************************************************
 * Copyright (c) 2017 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *	 IBM Corporation - initial API and implementation
 *******************************************************************************/

'use strict';

var cp = require('child_process');
var DebugProtocol = require('vscode-debugprotocol');
var VSCodeProtocol = require('vscode-debugadapter/lib/protocol');
var Messages = require('vscode-debugadapter/lib/messages');

/**
 * A debug adapter that implements the Visual Studio Code Debug Protocol
 * 
 * @see https://github.com/Microsoft/vscode-debugadapter-node/blob/master/protocol/src/debugProtocol.ts
 * 
 * @param {Object} debuggerConfig
 * @param {string} cwd
 */
var DebugAdapter = function(debuggerConfig, cwd) {
    var protocol = new VSCodeProtocol.ProtocolServer();
    protocol._handleData = function(data) {
        this._rawData = Buffer.concat([this._rawData, data]);
        while (true) {
            if (this._contentLength >= 0) {
                if (this._rawData.length >= this._contentLength) {
                    var message = this._rawData.toString('utf8', 0, this._contentLength);
                    this._rawData = this._rawData.slice(this._contentLength);
                    this._contentLength = -1;
                    if (message.length > 0) {
                        try {
                            var msg = JSON.parse(message);
                            if (msg.type === 'request') {
                                this.dispatchRequest(msg);
                            }
                            else if (msg.type === 'response') {
                                var response = msg;
                                var clb = this._pendingRequests.get(response.request_seq);
                                if (clb) {
                                    this._pendingRequests.delete(response.request_seq);
                                    clb(response);
                                }
                            }
                            else if (msg.type === 'event') {
                                this.emit('event', msg);
                            }
                        }
                        catch (e) {
                            this._emitEvent(new Messages.Event('error'));
                        }
                    }
                    continue; // there may be more complete messages to process
                }
            }
            else {
                var idx = this._rawData.indexOf(VSCodeProtocol.ProtocolServer.TWO_CRLF);
                if (idx !== -1) {
                    var header = this._rawData.toString('utf8', 0, idx);
                    var lines = header.split('\r\n');
                    for (var i = 0; i < lines.length; i++) {
                        var pair = lines[i].split(/: +/);
                        if (pair[0] == 'Content-Length') {
                            this._contentLength = +pair[1];
                        }
                    }
                    this._rawData = this._rawData.slice(idx + VSCodeProtocol.ProtocolServer.TWO_CRLF.length);
                    continue;
                }
            }
            break;
        }
    };
    protocol.dispatchRequest = function(request) {
        this.emit('request', request);
    };
    protocol.dispose = function() {
        if (this._adapterOn) {
            var adapter = this._adapter;
            this.sendRequest('disconnect', {
                restart: false
            }, 1000, function(response) {
                adapter.kill('SIGINT');
            });
        }
    };
    
    // Save CWD
    // We can safely do this because node is a single thread environment
    var cwdOrig = process.cwd();

    // Go to adapter CWD
    process.chdir(cwd);

    // Spawn adapter process
    var program, args;
    if (debuggerConfig.runtime) {
        program = debuggerConfig.runtime;
        args = debuggerConfig.runtimeArgs || [];
        // args = args.concat(['--debug', debuggerConfig.program]);
        args = args.concat([debuggerConfig.program]);
        args = args.concat(debuggerConfig.args || []);
    } else {
        program = debuggerConfig.program;
        args = debuggerConfig.args || [];
    }
    protocol._adapter = cp.spawn(program, args);
    protocol._adapterOn = !!protocol._adapter;
    protocol.start(protocol._adapter.stdout, protocol._adapter.stdin);
    protocol._adapter.stderr.on('data', function(data) {
        console.error(data.toString());
    });
    protocol._adapter.on('exit', function() {
        protocol._adapterOn = false;
        protocol.emit('disposed');
    });

    // Restore CWD
    process.chdir(cwdOrig);
    
    return protocol;
};

module.exports = DebugAdapter;
