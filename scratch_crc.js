function crc16_x25(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0x8408;
            else crc >>= 1;
        }
    }
    return (~crc) & 0xFFFF;
}
const hex2 = "1101086229205314973870111f41021a";
const buf2 = Buffer.from(hex2, 'hex');
console.log("X.25:", crc16_x25(buf2).toString(16));

function crc16_ccitt_false(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
            else crc <<= 1;
        }
    }
    return crc & 0xFFFF;
}
console.log("CCITT-FALSE:", crc16_ccitt_false(buf2).toString(16));

function crc16_ccitt(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0x8408;
            else crc >>= 1;
        }
    }
    return crc & 0xFFFF;
}
console.log("CCITT (Kermit):", crc16_ccitt(buf2).toString(16));

// GT06 uses CCITT-16 (X.25 is actually polynomial 8408, init FFFF, ref true, XOR out FFFF)
// GT06 spec says CRC-ITU
function crc_itu(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0x8408;
            else crc >>= 1;
        }
    }
    return crc & 0xFFFF;
}

// Another ITU
function crc_itu_ffff(buffer) {
    let crc = 0xFFFF;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0x8408;
            else crc >>= 1;
        }
    }
    return crc & 0xFFFF;
}
console.log("CRC-ITU (FFFF, ref, no xor out):", crc_itu_ffff(buf2).toString(16));

// Try without length byte
const hex3 = "01086229205314973870111f41021a";
const buf3 = Buffer.from(hex3, 'hex');
console.log("Without length - X.25:", crc16_x25(buf3).toString(16));
console.log("Without length - CCITT-FALSE:", crc16_ccitt_false(buf3).toString(16));
console.log("Without length - ITU-FFFF:", crc_itu_ffff(buf3).toString(16));
