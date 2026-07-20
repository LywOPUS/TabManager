import{a as e,i as t,n,o as r,t as i}from"./chunks/jsx-runtime-9_y1tNj3.js";import{n as a,t as o}from"./chunks/glass-card-DtSXEFx3.js";import{t as s}from"./chunks/dist-CWvu98uo.js";var c=r(e(),1),l=t(),u=`
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  var out: VSOut;
  out.pos = vec4f(p[vi], 0.0, 1.0);
  out.uv = p[vi] * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}
`,d=`
struct Uniforms {
  resolution: vec2f,
  time: f32,
  radius: f32,
  bezel: f32,
  thickness: f32,
  blur: f32,
  chroma: f32,
  tint: vec4f,
  light: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise(x);
    x = x * 2.02 + 17.0;
    a *= 0.5;
  }
  return v;
}

fn backdrop(uv: vec2f, t: f32) -> vec3f {
  let p = uv * vec2f(1.4, 1.0);
  let n1 = fbm(p * 2.2 + vec2f(t * 0.07, -t * 0.05));
  let n2 = fbm(p * 3.1 + vec2f(-t * 0.04, t * 0.06) + 8.0);
  let blobA = exp(-length(uv - vec2f(0.22 + 0.04 * sin(t * 0.6), 0.28)) * 4.2);
  let blobB = exp(-length(uv - vec2f(0.78, 0.55 + 0.05 * cos(t * 0.5))) * 3.6);
  let blobC = exp(-length(uv - vec2f(0.45, 0.82)) * 3.2);

  var col = vec3f(0.90, 0.91, 0.94);
  col = mix(col, vec3f(0.35, 0.62, 1.00), blobA * 0.85);
  col = mix(col, vec3f(0.45, 0.38, 0.92), blobB * 0.70);
  col = mix(col, vec3f(1.00, 0.62, 0.28), blobC * 0.55);
  col += (n1 - 0.5) * 0.08;
  col = mix(col, col * vec3f(1.05, 1.02, 1.08), n2 * 0.35);
  return clamp(col, vec3f(0.0), vec3f(1.0));
}

fn sdRoundRect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

fn sampleBg(uv: vec2f, t: f32) -> vec3f {
  let e = 1.0 / max(u.resolution.x, 1.0);
  let blurPx = clamp(u.blur, 0.0, 8.0);
  if (blurPx < 0.2) {
    return backdrop(uv, t);
  }
  var acc = vec3f(0.0);
  var wsum = 0.0;
  let taps = 9;
  for (var i = 0; i < taps; i++) {
    let a = f32(i) * 2.399963;
    let r = sqrt(f32(i) + 0.5) / sqrt(f32(taps));
    let o = vec2f(cos(a), sin(a)) * r * blurPx * e * 18.0;
    let w = 1.0 - r * 0.35;
    acc += backdrop(uv + o, t) * w;
    wsum += w;
  }
  return acc / wsum;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = max(u.resolution, vec2f(1.0));
  let px = uv * res;
  let halfSize = res * 0.5;
  let center = halfSize;
  let p = px - center;

  let maxR = min(halfSize.x, halfSize.y);
  let radius = clamp(u.radius, 0.0, maxR);
  let box = halfSize - vec2f(1.5);
  let d = sdRoundRect(p, box, radius);

  // Outside glass: show soft procedural field (shell fills the panel)
  let outside = smoothstep(1.5, -0.5, d);
  if (outside < 0.001) {
    return vec4f(backdrop(uv, u.time) * 0.92, 1.0);
  }

  // Edge bezel: stronger refraction near rim
  let bezel = max(u.bezel, 1.0);
  let edge = clamp(1.0 - abs(d) / bezel, 0.0, 1.0);
  let edge2 = edge * edge;

  // Approximate gradient via finite differences
  let eps = 1.5;
  let dx = sdRoundRect(p + vec2f(eps, 0.0), box, radius) - sdRoundRect(p - vec2f(eps, 0.0), box, radius);
  let dy = sdRoundRect(p + vec2f(0.0, eps), box, radius) - sdRoundRect(p - vec2f(0.0, eps), box, radius);
  var n = vec2f(dx, dy);
  let nl = length(n);
  if (nl > 1e-4) { n = n / nl; } else { n = vec2f(0.0); }

  let thick = u.thickness * (0.35 + 0.65 * edge2);
  var refrUv = uv - n * thick * 0.04;

  // Mild whole-surface lens
  let lens = (uv - 0.5) * (1.0 - 0.06 * u.thickness);
  refrUv = mix(refrUv, lens + 0.5, 0.25);

  let chroma = u.chroma * edge2;
  let cR = sampleBg(refrUv + n * chroma * 0.004, u.time);
  let cG = sampleBg(refrUv, u.time);
  let cB = sampleBg(refrUv - n * chroma * 0.004, u.time);
  var col = vec3f(cR.r, cG.g, cB.b);

  // Specular rim
  let L = normalize(u.light);
  let spec = pow(max(dot(n, L), 0.0), 28.0) * edge2;
  let rim = pow(edge, 1.6) * 0.22;
  col += vec3f(1.0) * (spec * 0.55 + rim * 0.35);

  // Tint / frost body
  col = mix(col, u.tint.rgb, u.tint.a * (0.35 + 0.25 * (1.0 - edge)));

  // Inner highlight band (top)
  let topGlow = smoothstep(0.0, 0.55, 1.0 - uv.y) * 0.08 * (1.0 - edge * 0.5);
  col += vec3f(topGlow);

  let alpha = mix(0.96, 1.0, edge2);
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.2)), alpha);
}
`,f={radius:18,bezel:14,thickness:1.35,blur:2.2,chroma:1.1,tint:[.96,.97,1,.18],light:[-.55,-.75]};function p(e,t,n,r,i,a){let o=new Float32Array(16);o[0]=n,o[1]=r,o[2]=i,o[3]=a.radius,o[4]=a.bezel,o[5]=a.thickness,o[6]=a.blur,o[7]=a.chroma,o[8]=a.tint[0],o[9]=a.tint[1],o[10]=a.tint[2],o[11]=a.tint[3],o[12]=a.light[0],o[13]=a.light[1],o[14]=0,o[15]=0,e.queue.writeBuffer(t,0,o)}async function m(e){if(!navigator.gpu)return null;let t=await navigator.gpu.requestAdapter();if(!t)return null;let n=await t.requestDevice(),r=navigator.gpu.getPreferredCanvasFormat(),i=e.getContext(`webgpu`);if(!i)return null;i.configure({device:n,format:r,alphaMode:`premultiplied`});let a=n.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),o=n.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:`uniform`}}]}),s=n.createPipelineLayout({bindGroupLayouts:[o]}),c=n.createShaderModule({code:u+`
`+d});return{device:n,context:i,pipeline:n.createRenderPipeline({layout:s,vertex:{module:c,entryPoint:`vs`},fragment:{module:c,entryPoint:`fs`,targets:[{format:r,blend:{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}]},primitive:{topology:`triangle-list`}}),bindGroup:n.createBindGroup({layout:o,entries:[{binding:0,resource:{buffer:a}}]}),uniformBuffer:a,format:r}}function h(e,t,n,r,i){let a=Math.max(1,Math.floor(t.clientWidth*i)),o=Math.max(1,Math.floor(t.clientHeight*i));(t.width!==a||t.height!==o)&&(t.width=a,t.height=o),p(e.device,e.uniformBuffer,a,o,n,{...r,radius:r.radius*i,bezel:r.bezel*i});let s=e.device.createCommandEncoder(),c=s.beginRenderPass({colorAttachments:[{view:e.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:`clear`,storeOp:`store`}]});c.setPipeline(e.pipeline),c.setBindGroup(0,e.bindGroup),c.draw(3),c.end(),e.device.queue.submit([s.finish()])}function g(e){e.uniformBuffer.destroy(),e.device.destroy()}var _=i();function v({className:e,contentClassName:t,style:r,children:i}){return(0,_.jsx)(`div`,{className:n(`relative overflow-hidden rounded-2xl`,`border border-white/50 bg-white/55 shadow-[0_2px_20px_rgba(0,0,0,0.06)]`,`backdrop-blur-[16px] backdrop-saturate-[1.6]`,e),style:r,"data-liquid-glass":`css-fallback`,children:(0,_.jsx)(`div`,{className:n(`relative z-[1]`,t),children:i})})}function y({children:e,className:t,contentClassName:r,style:i,params:a,fallback:o=!0}){let s=(0,c.useRef)(null),l=(0,c.useRef)(null),[u,d]=(0,c.useState)(`pending`),p=(0,c.useRef)({...f,...a});return p.current={...f,...a},(0,c.useEffect)(()=>{let e=l.current,t=s.current;if(!e||!t)return;let n=!1,r=0,i=null,a=performance.now();if(typeof matchMedia<`u`&&matchMedia(`(prefers-reduced-transparency: reduce)`).matches||!navigator.gpu){d(o?`fallback`:`pending`);return}return(async()=>{try{if(i=await m(e),n){i&&g(i);return}if(!i){d(o?`fallback`:`pending`);return}d(`webgpu`);let t=o=>{if(!i||n)return;let s=Math.min(window.devicePixelRatio||1,2),c=typeof matchMedia<`u`&&matchMedia(`(prefers-reduced-motion: reduce)`).matches?0:(o-a)/1e3;h(i,e,c,p.current,s),r=requestAnimationFrame(t)};r=requestAnimationFrame(t)}catch{n||d(o?`fallback`:`pending`)}})(),()=>{n=!0,cancelAnimationFrame(r),i&&g(i)}},[o]),u===`fallback`?(0,_.jsx)(v,{className:t,contentClassName:r,style:i,children:e}):(0,_.jsxs)(`div`,{ref:s,className:n(`relative overflow-hidden rounded-2xl`,t),style:i,"data-liquid-glass":u===`webgpu`?`webgpu`:`pending`,children:[(0,_.jsx)(`canvas`,{ref:l,className:`pointer-events-none absolute inset-0 h-full w-full`,"aria-hidden":!0}),(0,_.jsx)(`div`,{className:n(`relative z-[1]`,r),children:e})]})}function b(e,t){(t==null||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}function x(e,t,n){return(t=function(e){var t=function(e,t){if(typeof e!=`object`||!e)return e;var n=e[Symbol.toPrimitive];if(n!==void 0){var r=n.call(e,t);if(typeof r!=`object`)return r;throw TypeError(`@@toPrimitive must return a primitive value.`)}return(t===`string`?String:Number)(e)}(e,`string`);return typeof t==`symbol`?t:t+``}(t))in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function S(){return S=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)({}).hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e},S.apply(null,arguments)}function C(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),n.push.apply(n,r)}return n}function w(e){for(var t=1;t<arguments.length;t++){var n=arguments[t]==null?{}:arguments[t];t%2?C(Object(n),!0).forEach(function(t){x(e,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):C(Object(n)).forEach(function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))})}return e}function T(e,t){return function(e){if(Array.isArray(e))return e}(e)||function(e,t){var n=e==null?null:typeof Symbol<`u`&&e[Symbol.iterator]||e[`@@iterator`];if(n!=null){var r,i,a,o,s=[],c=!0,l=!1;try{if(a=(n=n.call(e)).next,t!==0)for(;!(c=(r=a.call(n)).done)&&(s.push(r.value),s.length!==t);c=!0);}catch(e){l=!0,i=e}finally{try{if(!c&&n.return!=null&&(o=n.return(),Object(o)!==o))return}finally{if(l)throw i}}return s}}(e,t)||function(e,t){if(e){if(typeof e==`string`)return b(e,t);var n={}.toString.call(e).slice(8,-1);return n===`Object`&&e.constructor&&(n=e.constructor.name),n===`Map`||n===`Set`?Array.from(e):n===`Arguments`||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?b(e,t):void 0}}(e,t)||function(){throw TypeError(`Invalid attempt to destructure non-iterable instance.
In order to be iterable, non-array objects must have a [Symbol.iterator]() method.`)}()}function E(e){var t,n=e.trim();if(t=/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(\d*\.?\d+))?\s*\)$/i.exec(n))return{r:parseInt(t[1],10),g:parseInt(t[2],10),b:parseInt(t[3],10),a:t[4]===void 0?1:parseFloat(t[4])};if(t=/^#([0-9a-f]{3})$/i.exec(n)){var r=t[1];return{r:parseInt(r[0]+r[0],16),g:parseInt(r[1]+r[1],16),b:parseInt(r[2]+r[2],16),a:1}}if(t=/^#([0-9a-f]{4})$/i.exec(n)){var i=t[1];return{r:parseInt(i[0]+i[0],16),g:parseInt(i[1]+i[1],16),b:parseInt(i[2]+i[2],16),a:parseInt(i[3]+i[3],16)/255}}if(t=/^#([0-9a-f]{6})$/i.exec(n)){var a=t[1];return{r:parseInt(a.slice(0,2),16),g:parseInt(a.slice(2,4),16),b:parseInt(a.slice(4,6),16),a:1}}if(t=/^#([0-9a-f]{8})$/i.exec(n)){var o=t[1];return{r:parseInt(o.slice(0,2),16),g:parseInt(o.slice(2,4),16),b:parseInt(o.slice(4,6),16),a:parseInt(o.slice(6,8),16)/255}}return null}var D,O,ee=(D=64,O=new Map,{get:function(e){var t=O.get(e);return t!==void 0&&(O.delete(e),O.set(e,t)),t},set:function(e,t){if(O.has(e))O.delete(e);else if(O.size>=D){var n=O.keys().next().value;n!==void 0&&O.delete(n)}O.set(e,t)},get size(){return O.size}});function k(e,t,n){if(typeof n==`number`&&Number.isFinite(n))return Math.max(0,Math.min(.45,n));if(!Number.isFinite(e)||e<=0||!Number.isFinite(t)||t<=0)return .06;var r=.75*e/t;return Math.max(.06,Math.min(.45,r))}function te(e,t,n,r){return{newwidth:Math.max(8,Math.round(e/n/r)*r),newheight:Math.max(8,Math.round(t/n/r)*r)}}function ne(e){var t=((typeof e==`number`&&Number.isFinite(e)?e:0)%360+360)%360;return Math.round(1e3*t)/1e3}function A(e){var t=e.width,n=e.height,r=e.divisor,i=e.quantStep,a=e.radius,o=e.border,s=e.lightness,c=e.alpha,l=e.displace,u=e.blend??`difference`,d=ne(e.angle),f=!1!==e.shapeAdapt,p=e.lens??`classic`,m=typeof e.lensStrength==`number`&&Number.isFinite(e.lensStrength)?Math.max(0,e.lensStrength):1,h=e.lensCenter?e.lensCenter[0]:.5,g=e.lensCenter?e.lensCenter[1]:.5,_=te(t,n,r,i),v=_.newwidth,y=_.newheight,b=.5*o*Math.min(v,y),x=Math.min(a,t/2,n/2)/r;if(p!==`classic`){var S,C=`<rect x="${b}" y="${b}" width="${v-2*b}" height="${y-2*b}" rx="${x}" fill="hsl(0 0% ${s}% / ${c})" style="filter:blur(${l}px)" />`;S=p===`convex`?function(e,t,n,r,i,a,o){var s=a*e,c=o*t,l=Math.max(8,.66*Math.min(e,t)),u=i>0?Math.min(.5,.3*i):0,d=Math.round(255*(.5+u)),f=Math.round(255*(.5-u)),p=r===0?``:` gradientTransform="rotate(${r} ${s} ${c})"`;return{defs:`${u>0?`<linearGradient id="cvxRed" gradientUnits="userSpaceOnUse" x1="${s-l}" y1="${c}" x2="${s+l}" y2="${c}"${p}><stop offset="0%" stop-color="rgb(${d},0,0)"/><stop offset="100%" stop-color="rgb(${f},0,0)"/></linearGradient>`:`<linearGradient id="cvxRed"><stop offset="0%" stop-color="rgb(128,0,0)"/></linearGradient>`}
          ${u>0?`<linearGradient id="cvxBlue" gradientUnits="userSpaceOnUse" x1="${s}" y1="${c-l}" x2="${s}" y2="${c+l}"${p}><stop offset="0%" stop-color="rgb(0,0,${d})"/><stop offset="100%" stop-color="rgb(0,0,${f})"/></linearGradient>`:`<linearGradient id="cvxBlue"><stop offset="0%" stop-color="rgb(0,0,128)"/></linearGradient>`}
          <radialGradient id="cvxEnv" gradientUnits="userSpaceOnUse" cx="${s}" cy="${c}" r="${l}" fx="${s}" fy="${c}"><stop offset="0%" stop-color="#fff"/><stop offset="40%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient>
          <mask id="cvxMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${e}" height="${t}"><rect x="0" y="0" width="${e}" height="${t}" fill="url(#cvxEnv)"/></mask>`,body:`<rect x="0" y="0" width="${e}" height="${t}" fill="black"/>
        <g>
          <rect x="0" y="0" width="${e}" height="${t}" rx="${n}" fill="rgb(128,0,0)"/>
          <rect x="0" y="0" width="${e}" height="${t}" rx="${n}" fill="url(#cvxRed)" mask="url(#cvxMask)"/>
        </g>
        <g style="mix-blend-mode: difference">
          <rect x="0" y="0" width="${e}" height="${t}" rx="${n}" fill="rgb(0,0,128)"/>
          <rect x="0" y="0" width="${e}" height="${t}" rx="${n}" fill="url(#cvxBlue)" mask="url(#cvxMask)"/>
        </g>`}}(v,y,x,d,m,h,g):p===`shift`?function(e,t,n,r,i,a){var o=i*Math.PI/180,s=Math.max(0,Math.min(.5,.25*a)),c=Math.round(255*(.5+s*Math.cos(o))),l=Math.round(255*(.5+s*Math.sin(o))),u=Math.min(e,t)/2-.5,d=Math.max(1,Math.min(n,u/3));return{defs:`<mask id="shiftMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${e}" height="${t}"><rect x="0" y="0" width="${e}" height="${t}" fill="black"/><rect x="${d}" y="${d}" width="${e-2*d}" height="${t-2*d}" rx="${Math.max(0,r-d)}" fill="white" style="filter:blur(${d}px)"/></mask>`,body:`<rect x="0" y="0" width="${e}" height="${t}" fill="rgb(128,0,128)"/>
        <rect x="0" y="0" width="${e}" height="${t}" rx="${r}" fill="rgb(${c},0,${l})" mask="url(#shiftMask)"/>`}}(v,y,b,x,d,m):function(e,t,n,r,i,a,o,s){var c=o*e,l=s*t,u=Math.min(1,Math.max(0,a)),d=Math.round(127*.42*u),f=Math.min(255,128+d),p=Math.max(0,128-d),m=Math.min(e,t)/2,h=Math.max(1.6*n,.4*Math.min(e,t)),g=(100*Math.max(0,m-h*u)/m).toFixed(2),_=i===0?``:` gradientTransform="rotate(${i} ${c} ${l})"`;return{defs:`<linearGradient id="rimRed" gradientUnits="userSpaceOnUse" x1="0" y1="${l}" x2="${e}" y2="${l}"${_}><stop offset="0%" stop-color="rgb(${p},0,0)"/><stop offset="50%" stop-color="rgb(128,0,0)"/><stop offset="100%" stop-color="rgb(${f},0,0)"/></linearGradient>
          <linearGradient id="rimBlue" gradientUnits="userSpaceOnUse" x1="${c}" y1="0" x2="${c}" y2="${t}"${_}><stop offset="0%" stop-color="rgb(0,0,${p})"/><stop offset="50%" stop-color="rgb(0,0,128)"/><stop offset="100%" stop-color="rgb(0,0,${f})"/></linearGradient>
          <radialGradient id="rimRadial" gradientUnits="userSpaceOnUse" cx="${c}" cy="${l}" r="${m}"${_}><stop offset="0%" stop-color="#000"/><stop offset="${g}%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/></radialGradient>
          <mask id="rimMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${e}" height="${t}"><rect x="0" y="0" width="${e}" height="${t}" fill="url(#rimRadial)"/></mask>`,body:`<rect x="0" y="0" width="${e}" height="${t}" fill="rgb(128,0,128)"/>
        <g mask="url(#rimMask)">
          <rect x="0" y="0" width="${e}" height="${t}" fill="black"/>
          <rect x="0" y="0" width="${e}" height="${t}" rx="${r}" fill="url(#rimRed)"/>
          <rect x="0" y="0" width="${e}" height="${t}" rx="${r}" fill="url(#rimBlue)" style="mix-blend-mode: screen"/>
        </g>`}}(v,y,b,x,d,m,h,g);var w=p===`rim`?S.body:`${S.body}
        ${C}`;return`
      <svg viewBox="0 0 ${v} ${y}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          ${S.defs}
        </defs>
        ${w}
      </svg>
    `}var T=`<rect x="${b}" y="${b}" width="${v-2*b}" height="${y-2*b}" rx="${x}" fill="hsl(0 0% ${s}% / ${c})" style="filter:blur(${l}px)" />`;if(f){var E=function(e,t,n){var r=e/2,i=t/2,a=Math.max(e,t),o=Math.round(255*e/a),s=Math.round(255*t/a),c=n===0?``:` gradientTransform="rotate(${n} ${r} ${i})"`;return`          <linearGradient id="red" gradientUnits="userSpaceOnUse" x1="${e}" y1="${i}" x2="0" y2="${i}"${c}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(${o},0,0)"/>
          </linearGradient>
          <linearGradient id="blue" gradientUnits="userSpaceOnUse" x1="${r}" y1="0" x2="${r}" y2="${t}"${c}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="rgb(0,0,${s})"/>
          </linearGradient>`}(v,y,d),D=Math.min(t,n),O=Number.isFinite(e.scale)?e.scale:0,ee=k(O,D,e.edgeFeather),A=function(e,t,n){if(!Number.isFinite(e)||e<=0||!Number.isFinite(t)||t<=0)return 1;var r=k(e,t,n)*t;return Math.max(0,Math.min(1,r/(.75*e)))}(O,D,e.edgeFeather),re=Math.min(v,y),j=Math.max(.5,ee*re),ie=Math.max(0,x-j),ae=Math.max(.5,.5*j),oe=Math.max(.6,.01*re),se=A<.999?` opacity="${Math.round(1e3*A)/1e3}"`:``;return`
      <svg viewBox="0 0 ${v} ${y}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${E}
          <mask id="clsEnv" maskUnits="userSpaceOnUse" x="0" y="0" width="${v}" height="${y}">
            <rect x="0" y="0" width="${v}" height="${y}" fill="#000"/>
            <rect x="${j}" y="${j}" width="${v-2*j}" height="${y-2*j}" rx="${ie}" fill="white" style="filter:blur(${ae}px)"/>
          </mask>
        </defs>
        <rect x="0" y="0" width="${v}" height="${y}" fill="rgb(128,128,128)"/>
        <g${se}>
          <g mask="url(#clsEnv)" style="filter:blur(${oe}px)">
            <rect x="0" y="0" width="${v}" height="${y}" rx="${x}" fill="url(#red)" />
            <rect x="0" y="0" width="${v}" height="${y}" rx="${x}" fill="url(#blue)" style="mix-blend-mode: ${u}" />
          </g>
        </g>
        ${T}
      </svg>
    `}return`
      <svg viewBox="0 0 ${v} ${y}" xmlns="http://www.w3.org/2000/svg">
        <defs>
${function(e){var t=e===0?``:` gradientTransform="rotate(${e} 0.5 0.5)"`;return`          <linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"${t}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"${t}>
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>`}(d)}
        </defs>
        <rect x="0" y="0" width="${v}" height="${y}" fill="black"/>
        <g style="filter:blur(${Math.max(.6,.01*Math.min(v,y))}px)">
          <rect x="0" y="0" width="${v}" height="${y}" rx="${x}" fill="url(#red)" />
          <rect x="0" y="0" width="${v}" height="${y}" rx="${x}" fill="url(#blue)" style="mix-blend-mode: ${u}" />
        </g>
        ${T}
      </svg>
    `}var re=[`ripple`,`flow`,`wobble`],j={ripple:{baseFrequencyX:.012,baseFrequencyY:.012,numOctaves:2,scale:15,seed:3,ampX:.004,ampY:.004,rateX:1.3,rateY:1.1},flow:{baseFrequencyX:.01,baseFrequencyY:.016,numOctaves:2,scale:18,seed:7,ampX:.006,ampY:0,rateX:.7,rateY:0},wobble:{baseFrequencyX:.006,baseFrequencyY:.006,numOctaves:1,scale:28,seed:11,ampX:.0022,ampY:.0022,rateX:.55,rateY:.5}},ie=function(e){return Math.round(1e4*e)/1e4},ae=`children.mode.scale.radius.border.lightness.displace.alpha.blur.dispersion.saturation.aberrationIntensity.frost.borderColor.glassColor.background.autoTextColor.textOnDark.textOnLight.forceTextColor.className.style.quality.autodetectquality.iosMinBlur.iosBlurMode.mobileFallback.effectMode.angle.shapeAdapt.lens.lensStrength.lensCenter.liquid.liquidSpeed.liquidScale`.split(`.`),oe={low:3,standard:3,high:2.5,extreme:2},se={low:24,standard:24,high:16,extreme:8};function ce(e){if(!e)return!1;var t=e.trim(),n=/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(\d*\.?\d+)\s*\)$/i.exec(t);if(n){var r=parseFloat(n[1]);return r>0&&r<1}var i=/^hsla\(.*?,\s*(\d*\.?\d+)\s*\)$/i.exec(t);if(i){var a=parseFloat(i[1]);return a>0&&a<1}var o=/^hsl\(.*?\/\s*(\d*\.?\d+)\s*\)$/i.exec(t);if(o){var s=parseFloat(o[1]);return s>0&&s<1}var c=/^#([0-9a-f]{4})$/i.exec(t);if(c){var l=c[1].slice(3,4),u=parseInt(l+l,16)/255;return u>0&&u<1}var d=/^#([0-9a-f]{8})$/i.exec(t);if(d){var f=d[1].slice(6,8),p=parseInt(f,16)/255;return p>0&&p<1}return!1}function M(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:.3,n=e.trim(),r=/^#([0-9a-f]{3})$/i.exec(n);if(r)return`rgba(${parseInt(r[1][0]+r[1][0],16)}, ${parseInt(r[1][1]+r[1][1],16)}, ${parseInt(r[1][2]+r[1][2],16)}, ${t})`;var i=/^#([0-9a-f]{6})$/i.exec(n);if(i)return`rgba(${parseInt(i[1].slice(0,2),16)}, ${parseInt(i[1].slice(2,4),16)}, ${parseInt(i[1].slice(4,6),16)}, ${t})`;var a=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(n);if(a)return`rgba(${parseInt(a[1],10)}, ${parseInt(a[2],10)}, ${parseInt(a[3],10)}, ${t})`;var o=/^hsl\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)$/i.exec(n);return o?`hsla(${o[1].trim()}, ${o[2].trim()}, ${o[3].trim()}, ${t})`:n}function le(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:.3;if(e)return ce(e)?e:e.includes(`gradient`)?function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:.3,n=/^(linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient|repeating-radial-gradient|repeating-conic-gradient)\s*\(/i.exec(e);if(!n)return e;for(var r=n[1],i=e.substring(r.length+1,e.length-1),a=[],o=``,s=0,c=0;c<i.length;c++){var l=i[c];if(l===`(`)s++;else if(l===`)`)s--;else if(l===`,`&&s===0){a.push(o.trim()),o=``;continue}o+=l}return a.push(o.trim()),`${r}(${a.map(function(e){var n=/(#[0-9a-f]{3,6}|rgb\([^)]+\)|hsl\([^)]+\)|rgba\([^)]+\)|hsla\([^)]+\))/i.exec(e);if(n){var r=n[1],i=M(r,t);return e.replace(r,i)}return e}).join(`, `)})`}(e,t):e.includes(`url(`)?e:M(e,t)}var ue={scale:160,radius:50,border:.05,lightness:53,displace:5,alpha:.9,blur:0,dispersion:50,saturation:140,aberrationIntensity:0,frost:.1,borderColor:`rgba(120, 120, 120, 0.7)`},N=(0,c.forwardRef)(function(e,t){var n,r,i=e.children,a=e.mode,o=a===void 0?`preset`:a,s=e.scale,l=s===void 0?160:s,u=e.radius,d=u===void 0?50:u,f=e.border,p=f===void 0?.05:f,m=e.lightness,h=m===void 0?53:m,g=e.displace,_=g===void 0?5:g,v=e.alpha,y=v===void 0?.9:v,b=e.blur,x=b===void 0?0:b,C=e.dispersion,D=C===void 0?50:C,O=e.saturation,k=O===void 0?140:O,M=e.aberrationIntensity,N=M===void 0?0:M,de=e.frost,P=de===void 0?.1:de,fe=e.borderColor,pe=fe===void 0?`rgba(120, 120, 120, 0.7)`:fe,me=e.glassColor,F=me===void 0?`rgba(255, 255, 255, 0.4)`:me,he=e.background,ge=e.autoTextColor,I=ge!==void 0&&ge,_e=e.textOnDark,ve=_e===void 0?`#ffffff`:_e,ye=e.textOnLight,L=ye===void 0?`#111111`:ye,be=e.forceTextColor,xe=be!==void 0&&be,Se=e.className,Ce=Se===void 0?``:Se,we=e.style,Te=we===void 0?{}:we,R=e.quality,Ee=e.autodetectquality,De=Ee!==void 0&&Ee,Oe=e.iosMinBlur,ke=Oe===void 0?7:Oe,Ae=e.iosBlurMode,je=Ae===void 0?`auto`:Ae,Me=e.mobileFallback,Ne=e.effectMode,z=Ne===void 0?`auto`:Ne,Pe=e.angle,Fe=Pe===void 0?0:Pe,Ie=e.shapeAdapt,B=Ie===void 0||Ie,Le=e.lens,V=Le===void 0?`classic`:Le,Re=e.lensStrength,ze=Re===void 0?1:Re,H=e.lensCenter,Be=e.liquid,Ve=Be!==void 0&&Be,He=e.liquidSpeed,Ue=He===void 0?1:He,We=e.liquidScale,Ge=function(e,t){if(e==null)return{};var n,r,i=function(e,t){if(e==null)return{};var n={};for(var r in e)if({}.hasOwnProperty.call(e,r)){if(t.indexOf(r)!==-1)continue;n[r]=e[r]}return n}(e,t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(r=0;r<a.length;r++)n=a[r],t.indexOf(n)===-1&&{}.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}(e,ae);r=o===`preset`?w(w({},ue),{},{scale:l,radius:d,border:p,lightness:h,displace:_,alpha:y,blur:x,dispersion:D,saturation:k,aberrationIntensity:N,frost:P,borderColor:pe,mode:`preset`,blend:`difference`,x:`R`,y:`B`}):{mode:o,scale:l,radius:d,border:p,lightness:h,displace:_,alpha:y,blur:x,dispersion:D,saturation:k,aberrationIntensity:N,frost:P,borderColor:pe,blend:`difference`,x:`R`,y:`B`};var U=(0,c.useRef)(null),Ke=(0,c.useRef)(null),qe=T((0,c.useState)({width:400,height:200}),2),W=qe[0],Je=qe[1],Ye=T((0,c.useState)(!1),2),Xe=Ye[0],Ze=Ye[1],Qe=T((0,c.useState)(!0),2),$e=Qe[0],et=Qe[1],tt=T((0,c.useState)(!1),2),nt=tt[0],rt=tt[1],it=T((0,c.useState)(L),2),at=it[0],ot=it[1],G=(0,c.useRef)(null);G.current||=`lg-text-${Math.random().toString(36).slice(2,9)}`;var st=R!=null,ct=`low`,lt=T((0,c.useState)(st?R:ct),2),K=lt[0],q=lt[1],ut=(0,c.useRef)(K);ut.current=K,(0,c.useEffect)(function(){if(st)q(R);else if(De)if(typeof window<`u`&&typeof navigator<`u`)if(typeof window.matchMedia==`function`&&window.matchMedia(`(prefers-reduced-motion: reduce)`).matches)q(`low`);else{var e=`simpleLiquidGlass_quality_v1`,t=function(t){var n=JSON.stringify({q:t,t:Date.now()});try{window.localStorage.setItem(e,n)}catch{}try{window.sessionStorage.setItem(e,n)}catch{}},n=function(){for(var t=0,n=[function(){return window.localStorage},function(){return window.sessionStorage}];t<n.length;t++){var r=n[t];try{var i=r().getItem(e);if(!i)continue;var a=JSON.parse(i);if(a&&a.q&&typeof a.t==`number`&&Date.now()-a.t<864e5)return a.q}catch{}}return null}();if(!n){var r=navigator.hardwareConcurrency||4,i=navigator.deviceMemory||4,a=navigator.userAgent||``,o=/Mobi|Android|iPhone|iPad|iPod/i.test(a),s=function(e){var t=e.cores,n=e.deviceMemory;return t<=2||n<=1?`low`:null}({cores:r,deviceMemory:i});if(s)return q(s),void t(s);var c,l=!1,u=function(){if(!l){for(var e=0,n=performance.now();performance.now()-n<12;)for(var a=0;a<200;a++)Math.sin(a+e)*Math.cos(1.3*a+e)+Math.sqrt(a+1)>1e9&&--e,e+=1;var s=Math.max(1,performance.now()-n);if(!l){var c=function(e){var t=e.cores,n=e.deviceMemory,r=e.isMobile,i=e.opsPerMs;return t<=2||n<=1||i<8e3?`low`:t<=4||n<=2||i<16e3||r?`standard`:t>=8&&n>=6&&i>=32e3&&!r?`extreme`:`high`}({cores:r,deviceMemory:i,isMobile:o,opsPerMs:e/s});q(c),t(c)}}},d=window.requestIdleCallback,f=0;return typeof d==`function`?f=d(u,{timeout:200}):c=setTimeout(u,1),function(){l=!0;var e=window.cancelIdleCallback;f&&typeof e==`function`&&e(f),c!==void 0&&clearTimeout(c)}}q(n)}else q(ct);else q(ct)},[R,De]),(0,c.useEffect)(function(){if(U.current){var e,t=-1,n=-1,r=!1,i=function(){if(U.current){var i=U.current.getBoundingClientRect(),a=i.width,o=i.height;a!==0&&o!==0&&(a===t&&o===n||(t=a,n=o,Je({width:a,height:o}),r&&(Ze(!0),e!==void 0&&clearTimeout(e),e=setTimeout(function(){return Ze(!1)},200)),r=!0))}};i();var a=new ResizeObserver(i);return a.observe(U.current),function(){e!==void 0&&clearTimeout(e),a.disconnect()}}},[]),(0,c.useEffect)(function(){if(typeof IntersectionObserver<`u`){var e=U.current;if(e){var t=new IntersectionObserver(function(e){var t=e[e.length-1];t&&et(t.isIntersecting)},{rootMargin:`200px`});return t.observe(e),function(){return t.disconnect()}}}},[]),(0,c.useEffect)(function(){var e;if(typeof window<`u`&&typeof window.matchMedia==`function`){var t=window.matchMedia(`(prefers-reduced-motion: reduce)`),n=function(){return rt(t.matches)};return n(),(e=t.addEventListener)==null||e.call(t,`change`,n),function(){return t.removeEventListener?.call(t,`change`,n)}}},[]),(0,c.useEffect)(function(){if(I){var e=new MutationObserver(function(){return a()}),t=null,n=!1,r=function(){var r=U.current?.parentElement??null;if(r){var i,a,o,s=function(e){for(var t=e;t;){var n=getComputedStyle(t).backgroundColor,r=n?E(n):null;if(r&&r.a>0)return r;t=t.parentElement}var i=getComputedStyle(document.body).backgroundColor;return i?E(i):null}(r);ot(s&&.2126*(a=[(i=s).r,i.g,i.b].map(function(e){return e/255}).map(function(e){return e<=.03928?e/12.92:((e+.055)/1.055)**2.4}))[0]+.7152*a[1]+.0722*a[2]<.5?ve:L),o=function(e){for(var t=e;t;){var n=E(getComputedStyle(t).backgroundColor);if(n&&n.a>0)return t;t=t.parentElement}return null}(r),n&&o===t||(e.disconnect(),e.observe(document.body,{attributes:!0,attributeFilter:[`class`,`style`]}),o&&o!==document.body&&e.observe(o,{attributes:!0,attributeFilter:[`class`,`style`]}),t=o,n=!0)}},i=0,a=function(){i||=requestAnimationFrame(function(){i=0,r()})};return r(),window.addEventListener(`resize`,a,{passive:!0}),window.addEventListener(`scroll`,a,{passive:!0,capture:!0}),function(){i&&cancelAnimationFrame(i),window.removeEventListener(`resize`,a),window.removeEventListener(`scroll`,a,!0),e.disconnect()}}},[I,ve,L]);var dt=Math.min(r.radius,W.width/2,W.height/2),ft=(0,c.useMemo)(function(){var e,t=W.width,n=W.height,i=oe[K]||3,a=se[K]||16,o=te(t,n,i,a),s=o.newwidth,c=o.newheight,l=ne(Fe),u=H?`${H[0]},${H[1]}`:`0.5,0.5`,d=r.scale+Math.abs(r.dispersion*r.aberrationIntensity),f=8*Math.round(d/8),p=`q:${K}|w:${s}|h:${c}|r:${r.radius}|b:${r.border}|l:${r.lightness}|a:${r.alpha}|d:${r.displace}|ang:${l}|sa:${+!!B}|ln:${V}|ls:${ze}|lc:${u}|sc:${f}`,m=(e=p,ee.get(e));if(m)return m;var h,g=(h={width:t,height:n,divisor:i,quantStep:a,radius:r.radius,border:r.border,lightness:r.lightness,alpha:r.alpha,displace:r.displace,blend:r.blend,angle:l,shapeAdapt:B,lens:V,lensStrength:ze,lensCenter:H,scale:d},`data:image/svg+xml,${encodeURIComponent(A(h))}`);return function(e,t){ee.set(e,t)}(p,g),g},[W,r,K,Fe,B,V,ze,H]),pt=`liquid-glass-filter-${(0,c.useId)()}`,mt=he?`transparent`:F&&ce(F)?F:`hsl(0 0% 100% / ${r.frost})`;F&&!ce(F)&&console.warn("[LiquidGlass] `glassColor` must be semi-transparent (alpha between 0 and 1). Falling back to frost-based color.");var ht,gt=function(){if(typeof navigator>`u`||typeof window>`u`)return!1;var e=navigator.userAgent||``,t=navigator.vendor||``,n=/Android/i.test(e),r=/(iPad|iPhone|iPod)/i.test(e),i=/Macintosh/i.test(e)&&navigator.maxTouchPoints>1,a=/Apple/i.test(t),o=window.webkit!==void 0,s=/Mobile/i.test(e);return!n&&(r||i)&&a&&o&&s}(),J=function(){if(typeof navigator>`u`)return!1;var e=navigator.userAgent||``;return/Mobi|Android|iPhone|iPad|iPod/i.test(e)}(),_t=function(){if(typeof navigator>`u`||gt)return!1;var e=navigator.userAgent||``;return!/firefox|fxios/i.test(e)&&/(chrome|chromium|edg|opr)\//i.test(e)}(),vt=gt&&je===`auto`?Math.max(x,ke):x,Y=z!==`off`&&z!==`blur`&&(z===`svg`?_t:!(!_t||Me===`css-only`||Me!==`svg`&&J)),yt=function(){return z===`off`?0:Math.max(0,K===`low`||J||z===`blur`?Math.min(vt,2):vt)}(),X=typeof(ht=Ve)==`string`&&re.includes(ht)?Ve:null,Z=!!X&&Y&&$e&&!nt&&z!==`off`,Q=X?function(e){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},n=j[e]??j.ripple,r=t.scale!=null&&Number.isFinite(t.scale)?t.scale:n.scale;return t.maxScale!=null&&Number.isFinite(t.maxScale)&&(r=Math.min(r,t.maxScale)),r=Math.max(0,r),{baseFrequencyX:n.baseFrequencyX,baseFrequencyY:n.baseFrequencyY,numOctaves:n.numOctaves,scale:r,seed:n.seed}}(X,{speed:Ue,scale:We,maxScale:J||K===`low`?14:void 0}):null;(0,c.useEffect)(function(){if(Z&&X){var e=Ke.current;if(e){var t=0,n=0,r=function(i){n||=i;var a=T(function(e,t){var n=arguments.length>2&&arguments[2]!==void 0?arguments[2]:1,r=j[e]??j.ripple,i=(Number.isFinite(t)?t:0)*(Number.isFinite(n)?n:1),a=r.baseFrequencyX+r.ampX*Math.sin(i*r.rateX),o=r.ampY?r.baseFrequencyY+r.ampY*Math.cos(i*r.rateY):r.baseFrequencyY;return[ie(Math.max(1e-4,a)),ie(Math.max(1e-4,o))]}(X,(i-n)/1e3,Ue),2),o=a[0],s=a[1];e.setAttribute(`baseFrequency`,`${o} ${s}`),t=requestAnimationFrame(r)};return t=requestAnimationFrame(r),function(){return cancelAnimationFrame(t)}}}},[Z,X,Ue]),(0,c.useImperativeHandle)(t,function(){return{get element(){return U.current},getQuality:function(){return ut.current}}},[]);var $=!Y&&z!==`off`,bt=$e?Y?`saturate(${r.saturation}%) url(#${pt})`:$?`blur(${$?Math.max(yt,K===`low`||J?8:11):0}px) saturate(${Math.max(r.saturation,180)}%)`:yt>0?`blur(${yt}px) saturate(${r.saturation}%)`:`saturate(${r.saturation}%)`:`none`,xt=K===`low`?Math.min(r.blur,2):r.blur,St={width:`100%`,height:`100%`,borderRadius:dt,position:`absolute`,zIndex:1,background:$?`linear-gradient(168deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.12) 11%, rgba(255,255,255,0.03) 46%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.08) 100%)`:mt,backdropFilter:bt,WebkitBackdropFilter:bt,overflow:`hidden`,boxShadow:$?`0 10px 30px rgba(0,0,0,0.20), inset 0 1px 1px rgba(255,255,255,0.75), inset 0 -2px 3px rgba(255,255,255,0.10), inset 0 0 0 1px rgba(255,255,255,0.22)`:void 0,willChange:Xe?`backdrop-filter, filter`:`auto`},Ct={position:`absolute`,inset:0,borderRadius:dt,zIndex:2,pointerEvents:`none`,background:`linear-gradient(315deg, ${r.borderColor} 0%, rgba(120, 120, 120, 0) 30%, rgba(120, 120, 120, 0) 70%, ${r.borderColor} 100%) border-box`,mask:`linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)`,maskComposite:`exclude`,WebkitMask:`linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)`,WebkitMaskComposite:`xor`,border:`1px solid transparent`},wt=w({width:`100%`,height:`100%`,position:`relative`,borderRadius:dt,background:le(he)},Te);return c.createElement(`div`,S({ref:U,className:Ce,style:wt,"data-liquid-glass":``},Ge),c.createElement(`div`,{style:St},Y&&z!==`off`&&$e&&c.createElement(`svg`,{className:`liquid-glass-filter`,style:{width:`100%`,height:`100%`,pointerEvents:`none`,position:`absolute`,inset:0},xmlns:`http://www.w3.org/2000/svg`},c.createElement(`defs`,null,c.createElement(`filter`,{id:pt,colorInterpolationFilters:`sRGB`},c.createElement(`feImage`,{href:ft,x:`0`,y:`0`,width:`100%`,height:`100%`,result:`map`}),K===`low`?c.createElement(c.Fragment,null,c.createElement(`feDisplacementMap`,{in:`SourceGraphic`,in2:`map`,scale:r.scale,xChannelSelector:r.x,yChannelSelector:r.y,result:`output`}),c.createElement(`feGaussianBlur`,{in:`output`,stdDeviation:xt,result:Z?`lqBase`:void 0})):c.createElement(c.Fragment,null,c.createElement(`feDisplacementMap`,{in:`SourceGraphic`,in2:`map`,scale:r.scale+r.dispersion*r.aberrationIntensity,xChannelSelector:r.x,yChannelSelector:r.y,result:`dispRed`}),c.createElement(`feColorMatrix`,{in:`dispRed`,type:`matrix`,values:`1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0`,result:`red`}),c.createElement(`feDisplacementMap`,{in:`SourceGraphic`,in2:`map`,scale:r.scale,xChannelSelector:r.x,yChannelSelector:r.y,result:`dispGreen`}),c.createElement(`feColorMatrix`,{in:`dispGreen`,type:`matrix`,values:`0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0`,result:`green`}),c.createElement(`feDisplacementMap`,{in:`SourceGraphic`,in2:`map`,scale:r.scale-r.dispersion*r.aberrationIntensity,xChannelSelector:r.x,yChannelSelector:r.y,result:`dispBlue`}),c.createElement(`feColorMatrix`,{in:`dispBlue`,type:`matrix`,values:`0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0`,result:`blue`}),c.createElement(`feBlend`,{in:`red`,in2:`green`,mode:`screen`,result:`rg`}),c.createElement(`feBlend`,{in:`rg`,in2:`blue`,mode:`screen`,result:`output`}),c.createElement(`feGaussianBlur`,{in:`output`,stdDeviation:xt,result:Z?`lqBase`:void 0})),Z&&Q&&c.createElement(c.Fragment,null,c.createElement(`feTurbulence`,{ref:Ke,type:`fractalNoise`,baseFrequency:`${Q.baseFrequencyX} ${Q.baseFrequencyY}`,numOctaves:Q.numOctaves,seed:Q.seed,result:`lqNoise`}),c.createElement(`feDisplacementMap`,{in:`lqBase`,in2:`lqNoise`,scale:Q.scale,xChannelSelector:`R`,yChannelSelector:`G`})))))),c.createElement(`div`,{className:`liquid-glass-border`,style:Ct}),i&&c.createElement(`div`,{style:{position:`relative`,zIndex:3,width:`100%`,height:`100%`,color:I?at:void 0,transition:`color 300ms ease`},className:xe&&(n=G.current)!=null?n:void 0},xe&&I&&c.createElement(`style`,null,`
                .${G.current}, .${G.current} * { transition: color 300ms ease; }
                .${G.current} { color: ${at} !important; }
                .${G.current} * { color: ${at} !important; }
              `),i))});N.displayName=`LiquidGlass`;function de(){return(0,_.jsxs)(`div`,{"aria-hidden":!0,className:`absolute inset-0 overflow-hidden bg-[#d1d1d6]`,children:[(0,_.jsx)(`div`,{className:`absolute inset-0 opacity-90`,style:{backgroundImage:`linear-gradient(135deg, #007aff 0%, transparent 42%), linear-gradient(225deg, #5856d6 0%, transparent 38%), linear-gradient(45deg, #ff9500 0%, transparent 35%)`}}),(0,_.jsx)(`div`,{className:`absolute left-[8%] top-[18%] h-24 w-24 rounded-full bg-white/70 blur-sm`}),(0,_.jsx)(`div`,{className:`absolute right-[10%] top-[52%] h-20 w-32 rounded-2xl bg-[#34c759]/50 rotate-12`}),(0,_.jsx)(`div`,{className:`absolute bottom-[12%] left-[28%] h-16 w-16 rounded-full border-4 border-white/80`})]})}function P({title:e,subtitle:t,license:n,children:r}){return(0,_.jsxs)(`section`,{className:`flex min-w-0 flex-1 flex-col gap-3`,children:[(0,_.jsxs)(`header`,{children:[(0,_.jsx)(`h2`,{className:`m-0 text-sm font-semibold tracking-tight`,children:e}),(0,_.jsx)(`p`,{className:`m-0 mt-1 text-xs text-muted-foreground`,children:t}),(0,_.jsx)(`p`,{className:`m-0 mt-0.5 text-[11px] text-muted-foreground/80`,children:n})]}),(0,_.jsxs)(`div`,{className:`relative h-[220px] overflow-hidden rounded-2xl ring-1 ring-black/10`,children:[(0,_.jsx)(de,{}),(0,_.jsx)(`div`,{className:`relative flex h-full flex-col justify-end gap-2.5 p-3.5`,children:r})]})]})}function fe(){return(0,_.jsxs)(`div`,{className:`mb-8 grid gap-4 md:grid-cols-2`,children:[(0,_.jsxs)(`div`,{children:[(0,_.jsx)(`h2`,{className:`m-0 mb-2 text-sm font-semibold`,children:`Popup 灰底 · simple-liquid-glass`}),(0,_.jsx)(`div`,{className:`w-[288px] overflow-hidden rounded-2xl bg-[#f2f2f7] ring-1 ring-black/10`,children:(0,_.jsxs)(`div`,{className:`flex flex-col gap-2.5 p-3.5`,children:[(0,_.jsx)(`p`,{className:`m-0 text-[15px] font-semibold tracking-tight`,children:`Tab Manager`}),(0,_.jsx)(N,{radius:14,blur:2,frost:.1,glassColor:`rgba(255,255,255,0.45)`,className:`px-3 py-2.5 text-xs`,children:(0,_.jsx)(`p`,{className:`m-0 font-medium`,children:`最近：工作会话（12 个标签）`})}),(0,_.jsx)(N,{radius:12,blur:1,glassColor:`rgba(255,255,255,0.4)`,className:`w-full px-3 py-2 text-center text-sm font-medium`,children:`收纳当前窗口`})]})})]}),(0,_.jsxs)(`div`,{children:[(0,_.jsx)(`h2`,{className:`m-0 mb-2 text-sm font-semibold`,children:`Popup 灰底 · WebGPU（自研）`}),(0,_.jsxs)(y,{className:`w-[288px] rounded-2xl ring-1 ring-black/10`,contentClassName:`flex flex-col gap-2.5 p-3.5`,params:{radius:16,bezel:16,thickness:1.5,blur:2.5,chroma:1.25},children:[(0,_.jsx)(`p`,{className:`m-0 text-[15px] font-semibold tracking-tight`,children:`Tab Manager`}),(0,_.jsx)(y,{className:`rounded-xl`,contentClassName:`px-3 py-2.5 text-xs`,params:{radius:12,bezel:10,thickness:1.1,blur:1.6,chroma:.9,tint:[1,1,1,.12]},children:(0,_.jsx)(`p`,{className:`m-0 font-medium`,children:`最近：工作会话（12 个标签）`})}),(0,_.jsx)(y,{className:`rounded-xl`,contentClassName:`px-3 py-2 text-center text-sm font-medium`,params:{radius:12,bezel:10,thickness:1.2,blur:1.8,chroma:1,tint:[1,1,1,.1]},children:`收纳当前窗口`})]})]})]})}function pe(){return(0,_.jsxs)(`div`,{className:`mx-auto max-w-[1200px] px-4 py-6`,children:[(0,_.jsxs)(`header`,{className:`mb-6`,children:[(0,_.jsx)(`h1`,{className:`m-0 text-xl font-semibold tracking-tight`,children:`玻璃效果对比沙箱`}),(0,_.jsxs)(`p`,{className:`m-0 mt-2 max-w-2xl text-sm text-muted-foreground`,children:[`灰底实测决定方案；花背景仅作参考。`,(0,_.jsx)(`code`,{className:`text-xs`,children:` http://localhost:5190/glass-compare.html`})]})]}),(0,_.jsx)(fe,{}),(0,_.jsxs)(`div`,{className:`flex flex-col gap-6 lg:flex-row`,children:[(0,_.jsxs)(P,{title:`@glasscn（当前）`,subtitle:`CSS backdrop-filter + SVG 位移`,license:`MIT · 已集成`,children:[(0,_.jsxs)(o,{glassVariant:`frosted`,className:`gap-2 px-3 py-2.5 text-xs`,children:[(0,_.jsx)(`p`,{className:`m-0 font-medium`,children:`会话卡片示例`}),(0,_.jsx)(`p`,{className:`m-0 text-muted-foreground`,children:`工作 · 12 个标签`})]}),(0,_.jsx)(a,{glassVariant:`frosted`,className:`w-full justify-center text-sm`,children:`收纳当前窗口`})]}),(0,_.jsxs)(P,{title:`simple-liquid-glass`,subtitle:`Chromium SVG 折射`,license:`MIT · ~10KB`,children:[(0,_.jsxs)(N,{radius:14,blur:2,frost:.08,glassColor:`rgba(255,255,255,0.42)`,className:`px-3 py-2.5 text-xs`,children:[(0,_.jsx)(`p`,{className:`m-0 font-medium`,children:`会话卡片示例`}),(0,_.jsx)(`p`,{className:`m-0 opacity-80`,children:`工作 · 12 个标签`})]}),(0,_.jsx)(N,{radius:12,blur:1,glassColor:`rgba(255,255,255,0.38)`,className:`w-full px-3 py-2 text-center text-sm font-medium`,children:`收纳当前窗口`})]}),(0,_.jsxs)(P,{title:`glass-lens-react`,subtitle:`SVG / canvas / WebGL`,license:`MIT`,children:[(0,_.jsxs)(`div`,{className:`glass-control relative overflow-hidden rounded-[14px]`,children:[(0,_.jsx)(s,{preset:`portfolio`,reveal:!0}),(0,_.jsxs)(`div`,{className:`relative px-3 py-2.5 text-xs`,children:[(0,_.jsx)(`p`,{className:`m-0 font-medium text-[#1d1d1f]`,children:`会话卡片示例`}),(0,_.jsx)(`p`,{className:`m-0 text-[#6e6e73]`,children:`工作 · 12 个标签`})]})]}),(0,_.jsxs)(`button`,{type:`button`,className:n(`glass-control relative w-full overflow-hidden rounded-xl border-0 bg-transparent`,`px-3 py-2 text-sm font-medium text-[#1d1d1f] cursor-pointer`),children:[(0,_.jsx)(s,{preset:`hero`,reveal:!0}),(0,_.jsx)(`span`,{className:`relative`,children:`收纳当前窗口`})]})]}),(0,_.jsxs)(P,{title:`WebGPU（自研）`,subtitle:`程序背景 + SDF 折射 / 色散 / 高光`,license:`项目内 · 有 CSS 回退`,children:[(0,_.jsxs)(y,{className:`rounded-xl`,contentClassName:`px-3 py-2.5 text-xs`,params:{radius:12,bezel:11,thickness:1.25,blur:2,chroma:1.1},children:[(0,_.jsx)(`p`,{className:`m-0 font-medium`,children:`会话卡片示例`}),(0,_.jsx)(`p`,{className:`m-0 opacity-80`,children:`工作 · 12 个标签`})]}),(0,_.jsx)(y,{className:`rounded-xl`,contentClassName:`px-3 py-2 text-center text-sm font-medium`,params:{radius:12,bezel:10,thickness:1.15,blur:1.8,chroma:1},children:`收纳当前窗口`})]})]})]})}(0,l.createRoot)(document.getElementById(`root`)).render((0,_.jsx)(c.StrictMode,{children:(0,_.jsx)(pe,{})}));