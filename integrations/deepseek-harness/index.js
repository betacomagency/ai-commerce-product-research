import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export const name = 'commerce-research-tools'
export const inject = ['tools']

export const Config = Schema.object({
  appBaseUrl: Schema.string().default('http://127.0.0.1:3000'),
})

export function apply(ctx, config) {
  const baseUrl = config.appBaseUrl.replace(/\/$/, '')

  ctx.tools.register(defineTool({
    name: 'commerce_research_create',
    description: 'Create and start a durable Product Research Job from a name, description, local image, or any combination. The job identifies the product, researches sources, builds Product Knowledge and a Shopee Commerce Package. Use commerce_research_get to observe progress.',
    parameters: {
      productName: { type: 'string', description: 'Product name, brand, or model supplied by the user. Optional when an image is supplied.' },
      additionalInfo: { type: 'string', description: 'Any extra user-provided product description.' },
      imagePath: { type: 'string', description: 'Absolute local path of an uploaded product reference image. Use this for image-only or image-assisted research.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      if (!args.productName && !args.additionalInfo && !args.imagePath) throw new Error('Provide productName, additionalInfo, or imagePath.')
      const form = new FormData()
      form.set('productName', args.productName || '')
      form.set('additionalInfo', args.additionalInfo || '')
      if (args.imagePath) {
        const buffer = await readFile(args.imagePath)
        const mimeType = mimeTypeFor(args.imagePath)
        form.set('image', new Blob([buffer], { type: mimeType }), basename(args.imagePath))
      }
      const response = await fetch(`${baseUrl}/api/jobs`, {
        method: 'POST',
        body: form,
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(`Commerce app returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response.json()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_research_get',
    description: 'Read a Product Research Job, including action logs, sources, confidence, Product Knowledge, Shopee Commerce Package, four-image plan and generated image assets.',
    parameters: {
      jobId: { type: 'string', required: true, description: 'Job ID returned by commerce_research_create.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(args.jobId)}`, { signal: exec.signal })
      if (!response.ok) throw new Error(`Commerce app returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response.json()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_package_build',
    description: 'Build or rebuild the evidence-safe Shopee listing, product attributes, communication keywords, four-image creative plan, and short-video storyboard for a completed Product Research Job.',
    parameters: {
      jobId: { type: 'string', required: true, description: 'Completed Product Job ID.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(args.jobId)}/commerce-package`, {
        method: 'POST',
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(`Commerce app returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response.json()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'commerce_images_generate',
    description: 'Start generation of exactly four Shopee square images (one cover and three product-description images) from a Product Job Commerce Package using GPT Image through TokenRouter. This deducts TokenRouter balance. Poll with commerce_research_get until generatedAssets contains four items.',
    parameters: {
      jobId: { type: 'string', required: true, description: 'Product Job ID with a Commerce Package.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const response = await fetch(`${baseUrl}/api/jobs/${encodeURIComponent(args.jobId)}/generate-images`, {
        method: 'POST',
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(`Commerce app returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response.json()
    },
  }))
}

function mimeTypeFor(path) {
  return ({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  })[extname(path).toLowerCase()] || 'application/octet-stream'
}
