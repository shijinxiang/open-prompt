(function(root){
  const table=new Uint32Array(256);
  for(let i=0;i<256;i++){let n=i;for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;table[i]=n>>>0;}
  function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
  function header(length){const bytes=new Uint8Array(length);return {bytes,view:new DataView(bytes.buffer)};}
  async function zip(files){
    const body=[],directory=[];let offset=0,centralSize=0;
    if(files.length>65535)throw Error('文件数量超过 ZIP 限制');
    for(const file of files){
      const name=new TextEncoder().encode(file.name);const data=new Uint8Array(await file.blob.arrayBuffer());const crc=crc32(data);
      if(name.length>65535||data.length>0xffffffff||offset+data.length+name.length+30>0xffffffff)throw Error('迁移包超过 4GB，请分批导出记录');
      const local=header(30);const v=local.view;v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
      const central=header(46);const c=central.view;c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
      body.push(local.bytes,name,data);directory.push(central.bytes,name);offset+=30+name.length+data.length;centralSize+=46+name.length;
    }
    if(offset+centralSize>0xffffffff)throw Error('迁移包超过 ZIP 大小限制');
    const end=header(22);const v=end.view;v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
    return new Blob([...body,...directory,end.bytes],{type:'application/zip'});
  }
  root.QFArchive={zip,crc32};
})(globalThis);
