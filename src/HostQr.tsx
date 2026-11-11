import { useEffect,useRef,useState } from 'react';
import QRCode from 'qrcode';

// Only an address currently advertised by this Mac, on this server's actual port.
export function privateHostUrl(origins:string[],selected:string,credential:string|null){
 if(!credential||!origins.slice(1).includes(selected))return null;
 try{const address=new URL(selected),local=new URL(origins[0]);if(address.protocol!=='http:'||address.port!==local.port||['localhost','[::1]','0.0.0.0'].includes(address.hostname)||address.hostname.startsWith('127.'))return null;return `${selected}/host#${credential}`;}catch{return null;}
}
export function HostQrDialog({url,onClose}:{url:string|null;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);const [image,setImage]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{const d=dialog.current!;d.showModal();return()=>d.close();},[]);
 useEffect(()=>{let active=true;if(url)void QRCode.toDataURL(url,{width:420,margin:4,errorCorrectionLevel:'M',color:{dark:'#08172f',light:'#ffffff'}}).then(src=>{if(active)setImage(src);}).catch(()=>{if(active)setError('QR code could not be generated. Copy the private host link instead.');});return()=>{active=false;};},[url]);
 return <dialog ref={dialog} className="modal private-host-qr" aria-labelledby="private-host-qr-title" onCancel={e=>{e.preventDefault();onClose();}}><h2 id="private-host-qr-title">Connect your iPad</h2><p>Scan with your iPad camera to open host controls. Your iPad must be on the same Wi-Fi.</p><p className="muted">Private host access — keep this code off the public display and share it only with your host.</p>{url?<>{image?<img src={image} alt="Private host QR code"/>:<p role="status">Generating QR code…</p>}<label>Private iPad host link<input aria-label="Private iPad host link" readOnly value={url} onFocus={e=>e.target.select()}/></label></>:<p role="status">Choose a current Wi-Fi address in the library’s iPad / network address menu. Localhost cannot connect your iPad. If no Wi-Fi address is listed, connect this MacBook to Wi-Fi and refresh the library.</p>}{error&&<p role="alert" className="error">{error}</p>}{notice&&<p role="status">{notice}</p>}<div className="modal-actions"><button className="secondary" disabled={!url} onClick={async()=>{try{await navigator.clipboard.writeText(url!);setNotice('Host link copied.');}catch{setNotice('Select the private link above and copy it manually.');}}}>Copy host link</button><button className="gold" onClick={onClose}>Close</button></div></dialog>;
}
