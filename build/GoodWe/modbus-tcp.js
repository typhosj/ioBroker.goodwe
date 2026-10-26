"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModbusTcpSocket = void 0;
exports.crc16 = crc16;
const node_events_1 = __importDefault(require("node:events"));
const node_net_1 = __importDefault(require("node:net"));
// MBAP header: transaction id, protocol id and length, followed by the unit id.
const MBAP_HEADER_LENGTH = 6;
const RTU_CRC_LENGTH = 2;
// Bounds of the MBAP length field: unit id and function code at least, unit id
// and the largest Modbus PDU at most.
const MIN_ADU_LENGTH = 2;
const MAX_ADU_LENGTH = 1 + 253;
/**
 * Modbus CRC16 of Data[Start, Start + Length), byte swapped so that `>> 8`
 * yields the byte sent first.
 *
 * @param Data frame
 * @param Start first byte covered by the checksum
 * @param Length number of bytes covered by the checksum
 */
function crc16(Data, Start, Length) {
    let crc = 0xffff;
    for (let pos = Start; pos < Start + Length; pos++) {
        crc ^= Data[pos];
        for (let i = 8; i != 0; i--) {
            if ((crc & 0x0001) != 0) {
                crc >>= 1;
                crc ^= 0xa001;
            }
            else {
                crc >>= 1;
            }
        }
    }
    return ((crc & 0x00ff) << 8) + ((crc & 0xff00) >> 8);
}
/**
 * Wraps the RTU frame the UDP protocol sends into a Modbus TCP request.
 *
 * @param rtuFrame unit id, PDU and CRC
 * @param transactionId MBAP transaction id
 */
function toModbusTcpRequest(rtuFrame, transactionId) {
    const unitAndPdu = rtuFrame.subarray(0, rtuFrame.length - RTU_CRC_LENGTH);
    const header = Buffer.alloc(MBAP_HEADER_LENGTH);
    header.writeUInt16BE(transactionId, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(unitAndPdu.length, 4);
    return Buffer.concat([header, unitAndPdu]);
}
/**
 * Rewrites a Modbus TCP answer into the AA55 frame the UDP dongle sends, so
 * matchers and register parsers stay the same for both transports.
 *
 * @param adu complete Modbus TCP answer, MBAP header included
 */
function fromModbusTcpResponse(adu) {
    const unitAndPdu = adu.subarray(MBAP_HEADER_LENGTH);
    const frame = Buffer.alloc(2 + unitAndPdu.length + RTU_CRC_LENGTH);
    frame[0] = 0xaa;
    frame[1] = 0x55;
    unitAndPdu.copy(frame, 2);
    const crc = crc16(frame, 2, unitAndPdu.length);
    frame[frame.length - 2] = crc >> 8;
    frame[frame.length - 1] = crc & 0x00ff;
    return frame;
}
/**
 * Modbus TCP link with the part of the dgram socket interface GoodWeUdp uses:
 * `send()` takes the RTU frame, "message" delivers the answer as AA55 frame.
 *
 * Connects on the first send and again on the next send after the dongle
 * closed the connection. Never emits "error": a failed connection fails the
 * send, and a request whose answer is lost runs into its timeout.
 */
class ModbusTcpSocket extends node_events_1.default {
    #socket;
    #lastError;
    #received = Buffer.alloc(0);
    #transactionId = 0;
    #closed = false;
    send(buffer, _offset, _length, port, address, callback) {
        if (this.#closed) {
            callback(new Error("Socket closed"));
            return;
        }
        this.#transactionId = (this.#transactionId + 1) & 0xffff;
        const socket = this.#socket ?? this.#connect(port, address);
        socket.write(toModbusTcpRequest(buffer, this.#transactionId), (error) => {
            // A refused connection reaches the write only as "closed before
            // connection", the socket error names the actual cause.
            callback(error ? (this.#lastError ?? error) : null);
        });
    }
    close() {
        this.#closed = true;
        this.#socket?.destroy();
        this.#socket = undefined;
    }
    #connect(port, address) {
        const socket = node_net_1.default.connect({ host: address, port });
        this.#socket = socket;
        this.#lastError = undefined;
        this.#received = Buffer.alloc(0);
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this.#onData(chunk));
        socket.on("error", (error) => {
            this.#lastError = error;
        });
        socket.on("close", () => {
            if (this.#socket === socket) {
                this.#socket = undefined;
            }
        });
        return socket;
    }
    #onData(chunk) {
        this.#received = Buffer.concat([this.#received, chunk]);
        while (this.#received.length > MBAP_HEADER_LENGTH) {
            const length = this.#received.readUInt16BE(4);
            // Out of bounds, the stream lost its frame boundaries and only a new
            // connection finds them again. The request waiting for the answer runs
            // into its timeout, its retry connects again.
            if (length < MIN_ADU_LENGTH || length > MAX_ADU_LENGTH) {
                this.#received = Buffer.alloc(0);
                this.#socket?.destroy();
                this.#socket = undefined;
                return;
            }
            if (this.#received.length < MBAP_HEADER_LENGTH + length) {
                return;
            }
            const adu = this.#received.subarray(0, MBAP_HEADER_LENGTH + length);
            this.#received = this.#received.subarray(MBAP_HEADER_LENGTH + length);
            // Only the answer to the last request: GoodWeUdp sends one at a time.
            if (adu.readUInt16BE(0) === this.#transactionId &&
                adu.readUInt16BE(2) === 0) {
                this.emit("message", fromModbusTcpResponse(adu));
            }
        }
    }
}
exports.ModbusTcpSocket = ModbusTcpSocket;
