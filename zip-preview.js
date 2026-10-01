const MAX_MP4_BYTES = 75 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8');

function bounds(bytes, offset, size) {
  return Number.isInteger(offset) && Number.isInteger(size) && offset >= 0 && size >= 0 && offset + size <= bytes.length;
}

export async function extractReelMp4(zipInput) {
  const bytes = zipInput instanceof Uint8Array ? zipInput : new Uint8Array(zipInput);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signatureAt = (offset, signature) => bounds(bytes, offset, 4) && view.getUint32(offset, true) === signature;

  let endRecord = -1;
  const searchStart = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= searchStart; offset -= 1) {
    if (signatureAt(offset, 0x06054b50)) { endRecord = offset; break; }
  }
  if (endRecord < 0 || !bounds(bytes, endRecord, 22)) throw new Error('تعذر قراءة أرشيف النتيجة.');

  const entries = view.getUint16(endRecord + 10, true);
  let centralOffset = view.getUint32(endRecord + 16, true);
  if (entries === 0xffff || centralOffset === 0xffffffff) throw new Error('صيغة ZIP64 غير متوقعة لملف Reel واحد.');
  let found = null;

  for (let index = 0; index < entries; index += 1) {
    if (!signatureAt(centralOffset, 0x02014b50) || !bounds(bytes, centralOffset, 46)) throw new Error('بيانات ZIP غير مكتملة.');
    const method = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const uncompressedSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const nameStart = centralOffset + 46;
    if (!bounds(bytes, nameStart, nameLength)) throw new Error('اسم ملف ZIP غير صالح.');
    const name = UTF8.decode(bytes.subarray(nameStart, nameStart + nameLength));
    if (name.split('/').pop() === 'bili-reel-30s.mp4') {
      found = { method, compressedSize, uncompressedSize, localOffset };
      break;
    }
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  if (!found) throw new Error('لم يوجد ملف MP4 داخل أرشيف النتيجة.');
  if (found.uncompressedSize <= 0 || found.uncompressedSize > MAX_MP4_BYTES || found.compressedSize > bytes.length) {
    throw new Error('حجم ملف Reel خارج الحد المسموح للمعاينة.');
  }
  if (!signatureAt(found.localOffset, 0x04034b50) || !bounds(bytes, found.localOffset, 30)) throw new Error('ترويسة ملف ZIP غير صالحة.');
  const localNameLength = view.getUint16(found.localOffset + 26, true);
  const localExtraLength = view.getUint16(found.localOffset + 28, true);
  const dataStart = found.localOffset + 30 + localNameLength + localExtraLength;
  if (!bounds(bytes, dataStart, found.compressedSize)) throw new Error('بيانات MP4 داخل ZIP غير مكتملة.');
  const compressed = bytes.slice(dataStart, dataStart + found.compressedSize);

  let mp4;
  if (found.method === 0) {
    mp4 = new Blob([compressed], { type: 'video/mp4' });
  } else if (found.method === 8) {
    if (typeof DecompressionStream !== 'function') throw new Error('هذا المتصفح لا يدعم فك ضغط معاينة ZIP. استخدم زر تنزيل ZIP.');
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const expanded = await new Response(stream).arrayBuffer();
      mp4 = new Blob([expanded], { type: 'video/mp4' });
    } catch {
      throw new Error('تعذر فك ضغط معاينة MP4 في هذا المتصفح؛ استخدم زر تنزيل ZIP.');
    }
  } else {
    throw new Error('طريقة ضغط أرشيف النتيجة غير مدعومة.');
  }
  if (mp4.size !== found.uncompressedSize || mp4.size > MAX_MP4_BYTES) throw new Error('حجم MP4 لا يطابق بيانات الأرشيف.');
  return mp4;
}
