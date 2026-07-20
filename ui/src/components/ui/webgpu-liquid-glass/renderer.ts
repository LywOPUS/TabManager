import { FRAGMENT_WGSL, VERTEX_WGSL } from './shader'

export type LiquidGlassParams = {
  radius: number
  bezel: number
  thickness: number
  blur: number
  chroma: number
  tint: [number, number, number, number]
  light: [number, number]
}

export const DEFAULT_PARAMS: LiquidGlassParams = {
  radius: 18,
  bezel: 14,
  thickness: 1.35,
  blur: 2.2,
  chroma: 1.1,
  tint: [0.96, 0.97, 1.0, 0.18],
  light: [-0.55, -0.75],
}

type GpuState = {
  device: GPUDevice
  context: GPUCanvasContext
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  uniformBuffer: GPUBuffer
  format: GPUTextureFormat
}

function writeUniforms(
  device: GPUDevice,
  buffer: GPUBuffer,
  width: number,
  height: number,
  time: number,
  params: LiquidGlassParams,
) {
  // std140-ish packing for WGSL struct with vec2/f32/vec4
  const data = new Float32Array(16)
  data[0] = width
  data[1] = height
  data[2] = time
  data[3] = params.radius
  data[4] = params.bezel
  data[5] = params.thickness
  data[6] = params.blur
  data[7] = params.chroma
  data[8] = params.tint[0]
  data[9] = params.tint[1]
  data[10] = params.tint[2]
  data[11] = params.tint[3]
  data[12] = params.light[0]
  data[13] = params.light[1]
  data[14] = 0
  data[15] = 0
  device.queue.writeBuffer(buffer, 0, data)
}

export async function createLiquidGlassRenderer(
  canvas: HTMLCanvasElement,
): Promise<GpuState | null> {
  if (!navigator.gpu) return null
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const format = navigator.gpu.getPreferredCanvasFormat()
  const context = canvas.getContext('webgpu')
  if (!context) return null

  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  })

  const uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      },
    ],
  })

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  })

  const shaderModule = device.createShaderModule({
    code: VERTEX_WGSL + '\n' + FRAGMENT_WGSL,
  })

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module: shaderModule, entryPoint: 'vs' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  })

  return { device, context, pipeline, bindGroup, uniformBuffer, format }
}

export function renderLiquidGlassFrame(
  state: GpuState,
  canvas: HTMLCanvasElement,
  time: number,
  params: LiquidGlassParams,
  dpr: number,
) {
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  writeUniforms(state.device, state.uniformBuffer, width, height, time, {
    ...params,
    radius: params.radius * dpr,
    bezel: params.bezel * dpr,
  })

  const encoder = state.device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: state.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass.setPipeline(state.pipeline)
  pass.setBindGroup(0, state.bindGroup)
  pass.draw(3)
  pass.end()
  state.device.queue.submit([encoder.finish()])
}

export function destroyLiquidGlassRenderer(state: GpuState) {
  state.uniformBuffer.destroy()
  state.device.destroy()
}
