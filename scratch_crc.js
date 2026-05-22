const buf = Buffer.from('05017011', 'hex');

// CRC-16/X-25 (0x8408)
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
console.log('X25:', crc16_x25(buf).toString(16));

// CRC-16/X-25 (no invert)
function crc16_x25_no_invert(buffer) {
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
console.log('X25_no_invert:', crc16_x25_no_invert(buf).toString(16));

// CRC-16/CCITT-FALSE
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
console.log('CCITT_FALSE:', crc16_ccitt_false(buf).toString(16));

// CRC-16/ARC
function crc16_arc(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0xA001;
            else crc >>= 1;
        }
    }
    return crc & 0xFFFF;
}
console.log('ARC:', crc16_arc(buf).toString(16));

// CRC-16/MAXIM
function crc16_maxim(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= buffer[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 1) crc = (crc >> 1) ^ 0xA001;
            else crc >>= 1;
        }
    }
    return (~crc) & 0xFFFF;
}
console.log('MAXIM:', crc16_maxim(buf).toString(16));

// CRC-ITU-T
function crc16_itu_t(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
            else crc <<= 1;
        }
    }
    return crc & 0xFFFF;
}
console.log('ITU-T:', crc16_itu_t(buf).toString(16));
