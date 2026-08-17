import { describe, expect, it } from 'vitest'
import { analyzeProductInput, generateSearchQueries } from '../src/application/input-analysis.js'
import { productInputSchema } from '../src/domain/schema.js'

describe('product input analysis', () => {
  it('extracts only cautious identity hints from a name', () => {
    const input = productInputSchema.parse({
      productName: 'Erosska EL084',
      additionalInfo: 'Giày búp bê nữ\nMàu nâu',
      imagePath: null,
      imageMimeType: null,
      originalImageName: null,
    })
    const result = analyzeProductInput(input)

    expect(result.likelyBrand).toBe('Erosska')
    expect(result.likelyModel).toBe('EL084')
    expect(result.likelyProductType).toBe('giày')
    expect(result.missing).toContain('specifications.material')
    expect(generateSearchQueries(result, 3)).toHaveLength(3)
  })

  it('rejects an entirely empty input', () => {
    expect(() => productInputSchema.parse({})).toThrow(/Cần nhập tên/)
  })

  it('does not over-constrain search phrases and uses identity seen in the image', () => {
    const input = productInputSchema.parse({ productName: 'Camera IMOU A52P' })
    const analysis = analyzeProductInput(input, {
      visible_product_type: 'Security Camera',
      visible_brand: 'KOMEX x IMOU',
      visible_model: 'A52P (RANGER 2)',
    })

    expect(analysis.likelyBrand).toBe('IMOU')
    expect(analysis.likelyModel).toBe('A52P (RANGER 2)')
    expect(analysis.likelyProductType).toBe('Security Camera')
    const queries = generateSearchQueries(analysis, 7)
    expect(queries).toEqual([
      'IMOU A52P (RANGER 2)',
      'Camera IMOU A52P',
      'IMOU A52P (RANGER 2) Security Camera thông số kỹ thuật',
      'IMOU A52P (RANGER 2) specifications features',
      'IMOU A52P (RANGER 2) official',
      'IMOU A52P (RANGER 2) manual datasheet',
      'IMOU A52P (RANGER 2) review',
    ])
    expect(queries.every(query => !query.startsWith('"'))).toBe(true)
  })

  it('matches product types by complete words instead of substrings', () => {
    const input = productInputSchema.parse({
      productName: 'Camera A52P có cảnh báo chuyển động',
    })
    const analysis = analyzeProductInput(input)
    expect(analysis.likelyProductType).toBe('camera')
    expect(analysis.likelyProductType).not.toBe('áo')
    expect(analysis.likelyBrand).toBe('Unknown')
  })
})
