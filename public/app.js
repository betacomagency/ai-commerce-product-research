const state = {
  sessions: [],
  selectedSessionId: localStorage.getItem('selectedSessionId'),
  selectedJobId: null,
  selectedJob: null,
  jobs: [],
  pollTimer: null,
  config: null,
}

const $ = selector => document.querySelector(selector)
const form = $('#researchForm')
const submitButton = $('#submitButton')
const formError = $('#formError')
const imageInput = $('#productImage')
const imagePreview = $('#imagePreview')
const uploadLabel = $('#uploadLabel')

form.addEventListener('submit', createJob)
$('#refreshJobs').addEventListener('click', () => loadJobs(true))
$('#researchAgain').addEventListener('click', researchAgain)
$('#buildCommerce').addEventListener('click', buildCommercePackage)
$('#generateImages').addEventListener('click', generateImages)
$('#openReport').addEventListener('click', () => setReportMode(true))
$('#closeReport').addEventListener('click', () => setReportMode(false))
$('#printReport').addEventListener('click', printReport)
$('#newSession').addEventListener('click', createSession)
$('#saveSession').addEventListener('click', saveSession)
$('#sessionSelect').addEventListener('change', event => switchSession(event.target.value))
$('#sessionName').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); saveSession() }
})
imageInput.addEventListener('change', previewImage)

await loadConfig()
await loadSessions()

async function loadConfig() {
  try {
    const config = await api('/api/config')
    state.config = config
    const llm = config.capabilities.llmConfigured ? config.providers.llm : 'safe fallback'
    const vision = config.capabilities.visionConfigured ? config.providers.vision : 'vision off'
    const image = config.capabilities.imageGenerationConfigured ? config.providers.image : 'image off'
    $('#providerStatus').textContent = `${llm} · ${config.providers.search} · ${vision} · ${image}`
    $('#uploadHint').textContent = `JPG, PNG, WEBP, HEIC · tối đa ${config.maxUploadMb}MB`
  } catch {
    $('#providerStatus').textContent = 'Không kết nối được server'
  }
}

async function loadJobs(selectNewest) {
  try {
    if (!state.selectedSessionId) return
    const payload = await api(`/api/jobs?limit=30&sessionId=${encodeURIComponent(state.selectedSessionId)}`)
    state.jobs = payload.jobs
    renderJobList()
    if (selectNewest && state.jobs[0]) {
      state.selectedJobId = state.jobs[0].id
    } else if (state.selectedJobId && !state.jobs.some(job => job.id === state.selectedJobId)) {
      state.selectedJobId = null
    }
    if (state.selectedJobId) await selectJob(state.selectedJobId)
    else showEmptyWorkspace()
  } catch (error) {
    showFormError(error.message)
  }
}

async function loadSessions(preferredId) {
  try {
    const payload = await api('/api/sessions')
    state.sessions = payload.sessions
    const candidate = preferredId || state.selectedSessionId
    const selected = state.sessions.find(session => session.id === candidate) || state.sessions[0]
    if (!selected) return
    state.selectedSessionId = selected.id
    localStorage.setItem('selectedSessionId', selected.id)
    state.selectedJobId = localStorage.getItem(jobStorageKey(selected.id))
    renderSessionControls()
    await loadJobs(false)
  } catch (error) {
    showFormError(error.message)
  }
}

async function createSession() {
  const button = $('#newSession')
  button.disabled = true
  setSessionMessage('')
  try {
    const session = await api('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Session ${new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}` }),
    })
    state.selectedSessionId = session.id
    state.selectedJobId = null
    state.selectedJob = null
    localStorage.setItem('selectedSessionId', session.id)
    localStorage.removeItem(jobStorageKey(session.id))
    showEmptyWorkspace()
    form.reset()
    resetImagePreview()
    await loadSessions(session.id)
    $('#sessionName').focus()
    $('#sessionName').select()
    setSessionMessage('Đã tạo session mới. Workspace đang trống.')
  } catch (error) {
    setSessionMessage(error.message, true)
  } finally {
    button.disabled = false
  }
}

async function saveSession() {
  if (!state.selectedSessionId) return
  const name = $('#sessionName').value.trim()
  if (!name) return setSessionMessage('Hãy nhập tên session.', true)
  const button = $('#saveSession')
  button.disabled = true
  try {
    const updated = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    state.sessions = state.sessions.map(session => session.id === updated.id ? updated : session)
    renderSessionControls()
    setSessionMessage('Đã lưu session.')
  } catch (error) {
    setSessionMessage(error.message, true)
  } finally {
    button.disabled = false
  }
}

async function switchSession(sessionId) {
  if (!sessionId || sessionId === state.selectedSessionId) return
  clearTimeout(state.pollTimer)
  state.selectedSessionId = sessionId
  state.selectedJob = null
  state.selectedJobId = localStorage.getItem(jobStorageKey(sessionId))
  localStorage.setItem('selectedSessionId', sessionId)
  setSessionMessage('')
  renderSessionControls()
  showEmptyWorkspace()
  await loadJobs(false)
}

function renderSessionControls() {
  const select = $('#sessionSelect')
  select.innerHTML = state.sessions.map(session => `<option value="${escapeHtml(session.id)}" ${session.id === state.selectedSessionId ? 'selected' : ''}>${escapeHtml(session.name)} · ${session.jobCount} job</option>`).join('')
  const current = state.sessions.find(session => session.id === state.selectedSessionId)
  $('#sessionName').value = current?.name || ''
  $('#jobListTitle').textContent = current ? current.name : 'Product Jobs'
}

function setSessionMessage(message, isError = false) {
  const element = $('#sessionMessage')
  element.textContent = message
  element.classList.toggle('error', isError)
}

function jobStorageKey(sessionId) { return `selectedJobId:${sessionId}` }

async function createJob(event) {
  event.preventDefault()
  hideFormError()
  const formData = new FormData(form)
  formData.set('sessionId', state.selectedSessionId || '')
  const hasText = String(formData.get('productName') || '').trim() || String(formData.get('additionalInfo') || '').trim()
  const file = formData.get('image')
  if (!hasText && !(file instanceof File && file.size > 0)) {
    showFormError('Hãy nhập tên, thông tin sản phẩm hoặc chọn một ảnh.')
    return
  }

  setSubmitting(true)
  try {
    const job = await api('/api/jobs', { method: 'POST', body: formData })
    state.selectedJobId = job.id
    localStorage.setItem(jobStorageKey(state.selectedSessionId), job.id)
    form.reset()
    resetImagePreview()
    await loadSessions(state.selectedSessionId)
  } catch (error) {
    showFormError(error.message)
  } finally {
    setSubmitting(false)
  }
}

async function selectJob(id) {
  clearTimeout(state.pollTimer)
  state.selectedJobId = id
  localStorage.setItem(jobStorageKey(state.selectedSessionId), id)
  renderJobList()
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}`)
    state.selectedJob = job
    renderJob(job)
    if (isActive(job.status)) {
      state.pollTimer = setTimeout(() => selectJob(id), 1000)
    }
  } catch (error) {
    $('#errorCard').textContent = error.message
    $('#errorCard').classList.remove('hidden')
  }
}

async function researchAgain() {
  if (!state.selectedJobId) return
  const button = $('#researchAgain')
  button.disabled = true
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(state.selectedJobId)}/research-again`, { method: 'POST' })
    state.selectedJobId = job.id
    localStorage.setItem(jobStorageKey(state.selectedSessionId), job.id)
    await loadSessions(state.selectedSessionId)
  } catch (error) {
    $('#errorCard').textContent = error.message
    $('#errorCard').classList.remove('hidden')
  } finally {
    button.disabled = false
  }
}

async function buildCommercePackage() {
  if (!state.selectedJobId) return
  const button = $('#buildCommerce')
  button.disabled = true
  try {
    await api(`/api/jobs/${encodeURIComponent(state.selectedJobId)}/commerce-package`, { method: 'POST' })
    await selectJob(state.selectedJobId)
  } catch (error) {
    $('#errorCard').textContent = error.message
    $('#errorCard').classList.remove('hidden')
  } finally {
    button.disabled = false
  }
}

async function generateImages() {
  if (!state.selectedJobId) return
  const button = $('#generateImages')
  button.disabled = true
  try {
    await api(`/api/jobs/${encodeURIComponent(state.selectedJobId)}/generate-images`, { method: 'POST' })
    await selectJob(state.selectedJobId)
  } catch (error) {
    $('#errorCard').textContent = error.message
    $('#errorCard').classList.remove('hidden')
  } finally {
    button.disabled = false
  }
}

function renderJobList() {
  const list = $('#jobList')
  if (state.jobs.length === 0) {
    list.innerHTML = '<div class="empty-small">Chưa có job.</div>'
    return
  }
  list.innerHTML = state.jobs.map(job => {
    const title = job.input.productName || job.input.originalImageName || 'Product image'
    return `<button class="job-item ${job.id === state.selectedJobId ? 'active' : ''}" data-job-id="${escapeHtml(job.id)}">
      <div class="job-item-title">${escapeHtml(title)}</div>
      <div class="job-item-meta">
        <span class="tiny-status ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
        <time>${escapeHtml(relativeTime(job.updatedAt))}</time>
      </div>
    </button>`
  }).join('')
  list.querySelectorAll('[data-job-id]').forEach(button => {
    button.addEventListener('click', () => selectJob(button.dataset.jobId))
  })
}

function renderJob(job) {
  $('#emptyState').classList.add('hidden')
  $('#jobView').classList.remove('hidden')
  $('#jobTitle').textContent = job.input.productName || job.input.originalImageName || 'Product Research'
  $('#jobId').textContent = `#${job.id.slice(0, 8)}`
  $('#jobMeta').textContent = `Tạo ${formatDate(job.createdAt)} · Cập nhật ${formatDate(job.updatedAt)}`
  const badge = $('#jobStatus')
  badge.textContent = statusLabel(job.status)
  badge.className = `status-badge ${job.status}`
  $('#liveIndicator').classList.toggle('hidden', !isActive(job.status))
  $('#researchAgain').classList.toggle('hidden', isActive(job.status))
  $('#buildCommerce').classList.toggle('hidden', isActive(job.status) || !job.productKnowledge)
  $('#buildCommerce').textContent = job.commercePackage ? 'Tạo lại content' : 'Tạo content cho job cũ'
  const canGenerate = Boolean(job.commercePackage && state.config?.capabilities?.imageGenerationConfigured)
  $('#generateImages').classList.toggle('hidden', isActive(job.status) || !canGenerate)
  $('#generateImages').textContent = job.generatedAssets?.length ? 'Regenerate 4 images' : 'Generate 4 images'
  renderReportOverview(job)
  renderEvents(job.events)

  const errorCard = $('#errorCard')
  if (job.errorMessage) {
    errorCard.textContent = job.errorMessage
    errorCard.classList.remove('hidden')
  } else {
    errorCard.classList.add('hidden')
  }

  if (job.productKnowledge) {
    $('#knowledgeView').classList.remove('hidden')
    renderKnowledge(job.productKnowledge, job.commercePackage, job.generatedAssets || [])
  } else {
    $('#knowledgeView').classList.add('hidden')
  }
}

function renderReportOverview(job) {
  const pk = job.productKnowledge
  const pkg = job.commercePackage
  const sources = pk?.sources?.length || 0
  const readiness = pk ? readinessLabel(pk.readiness?.status || 'blocked') : 'Đang xử lý'
  const assets = job.generatedAssets?.length || 0
  const inputTypes = [job.input.productName && 'Tên sản phẩm', job.input.additionalInfo && 'Thông tin mô tả', job.input.imagePath && 'Ảnh tham chiếu'].filter(Boolean)
  $('#reportOverview').innerHTML = `
    <div class="report-kicker">Management report</div>
    <div class="report-overview-head">
      <div><h2>Executive summary</h2><p>Báo cáo nghiên cứu, nội dung bán hàng và kế hoạch creative được tạo từ dữ liệu có evidence.</p></div>
      <div class="report-generated">Xuất lúc ${escapeHtml(formatDate(new Date().toISOString()))}</div>
    </div>
    <div class="report-metrics">
      <div><span>Sources reviewed</span><strong>${sources}</strong></div>
      <div><span>Readiness</span><strong>${escapeHtml(readiness)}</strong></div>
      <div><span>Creative assets</span><strong>${assets}/4</strong></div>
    </div>
    <div class="report-summary-grid">
      <div><span>Đầu vào</span><strong>${escapeHtml(inputTypes.join(' · ') || 'Không xác định')}</strong></div>
      <div><span>Commerce package</span><strong>${pkg ? 'Đã tạo' : 'Chưa tạo'}</strong></div>
      <div><span>Publication status</span><strong>${escapeHtml(pkg?.publication_status || 'Chưa đánh giá')}</strong></div>
      <div><span>Job ID</span><strong>${escapeHtml(job.id)}</strong></div>
    </div>`
}

function setReportMode(enabled) {
  document.body.classList.toggle('report-mode', enabled)
  $('#openReport').classList.toggle('hidden', enabled)
  document.querySelectorAll('.report-only').forEach(element => element.classList.toggle('hidden', !enabled))
  $('#reportOverview').classList.toggle('hidden', !enabled)
  $('#progressTitle').textContent = enabled ? 'Research audit trail' : 'Progress'
  if (enabled) {
    document.querySelectorAll('#jobView details').forEach(details => { details.open = true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function printReport() {
  document.querySelectorAll('#jobView details').forEach(details => { details.open = true })
  window.print()
}

function showEmptyWorkspace() {
  clearTimeout(state.pollTimer)
  state.selectedJob = null
  $('#jobView').classList.add('hidden')
  $('#emptyState').classList.remove('hidden')
  $('#errorCard').classList.add('hidden')
}

function renderEvents(events) {
  const timeline = $('#progressEvents')
  timeline.innerHTML = events.map(event => `<div class="event ${escapeHtml(event.level)}">
    <div>${escapeHtml(event.message)}</div>
    <time class="event-time">${escapeHtml(formatTime(event.createdAt))}</time>
  </div>`).join('') || '<div class="empty-small">Agent chưa bắt đầu.</div>'
  timeline.scrollTop = state.selectedJob && isActive(state.selectedJob.status) ? timeline.scrollHeight : 0
}

function renderKnowledge(pk, commercePackage, generatedAssets) {
  const identity = pk.product_identity
  const specs = pk.specifications
  const sources = pk.sources || []
  const missing = pk.missing_information || []
  const evidence = pk.evidence || []
  const warnings = pk.warnings || []
  const readiness = pk.readiness || { status: 'blocked', downstream_allowed: false, blockers: ['Research cũ chưa được đánh giá readiness.'] }

  $('#knowledgeView').innerHTML = `
    <section class="knowledge-hero">
      <div>
        <div class="eyebrow">Product Knowledge · v${escapeHtml(pk.schema_version)}</div>
        <h2>${formatValue(identity.product_name)}</h2>
        <div class="identity-line">${formatValue(identity.brand)} · ${formatValue(identity.model)} · ${formatValue(identity.product_type)}</div>
      </div>
    </section>

    <div class="knowledge-grid commercial-grid">
      ${businessSection('01', 'Thông tin sản phẩm', `
        <div class="fact-grid product-summary-grid">
          ${fact('Thương hiệu', identity.brand)}
          ${fact('Model', identity.model)}
          ${fact('Loại sản phẩm', identity.product_type)}
          ${fact('Ngành hàng', `${pk.category.general_category} / ${pk.category.sub_category}`)}
          ${fact('Màu sắc', specs.color?.length ? specs.color.join(', ') : 'Unknown')}
          ${fact('Chất liệu', specs.material)}
          ${fact('Kích thước', specs.dimensions)}
          ${fact('Khối lượng', specs.weight)}
        </div>
        ${chipGroup('Tính năng nổi bật', specs.features)}
        ${chipGroup('Biến thể', specs.variants, 'neutral')}`, 'full')}

      ${businessSection('02', 'Phân tích USP & chiến lược truyền thông', commercePackage ? renderMarketingAnalysis(commercePackage.campaign) : commercePending(), 'full')}

      ${businessSection('03', 'Đề xuất tên sản phẩm chuẩn SEO Shopee', commercePackage ? `
        <div class="copy-block"><div class="fact-label">Tiêu đề đề xuất chính</div><div class="copy-title">${escapeHtml(commercePackage.listing.recommended_title)}</div></div>
        <div class="title-options">${commercePackage.listing.title_options.map((title, index) => `<div><b>Phương án ${index + 1}</b>${escapeHtml(title)}</div>`).join('')}</div>
        ${chipGroup('Từ khóa tìm kiếm', commercePackage.listing.search_keywords, 'neutral')}` : commercePending(), 'full')}

      ${businessSection('04', 'Mô tả đăng bán', commercePackage ? `
        <div class="description-block"><pre>${escapeHtml(commercePackage.listing.full_description)}</pre></div>` : commercePending(), 'full')}

      ${businessSection('05', 'Giá bán tham khảo', renderPricing(pk, commercePackage), 'full')}

      ${businessSection('06', 'Ảnh bìa và 3 ảnh content', commercePackage ? renderMediaProposal(commercePackage.media_plan, generatedAssets) : commercePending(), 'full')}

      ${businessSection('07', 'Video nên quay như nào', commercePackage ? renderVideoProposal(commercePackage.video_plan) : commercePending(), 'full')}

      ${businessSection('08', 'Thuộc tính đăng Shopee', commercePackage ? `
        <div class="attribute-grid">${Object.entries(commercePackage.shopee.attributes).map(([key, value]) => `<div class="fact"><div class="fact-label">${escapeHtml(key)}</div><div class="fact-value">${escapeHtml(value)}</div></div>`).join('') || '<div class="empty-small">Chưa có thuộc tính đủ evidence.</div>'}</div>
        ${chipGroup('Phân loại hàng', commercePackage.shopee.variation_strategy, 'neutral')}
        ${chipGroup('Lưu ý trước khi đăng', commercePackage.shopee.compliance_notes, 'neutral')}` : commercePending(), 'full')}

      ${businessSection('09', `Nguồn nghiên cứu (${sources.length})`, renderSources(sources), 'full')}

      <section class="panel knowledge-section full research-appendix">
        <details>
          <summary><span>Phụ lục kiểm chứng</span><small>Readiness · Evidence · Missing information · Warnings</small></summary>
          <div class="appendix-content">
            <div class="readiness-row"><span class="readiness-badge ${escapeHtml(readiness.status)}">${escapeHtml(readinessLabel(readiness.status))}</span><span class="readiness-note">${readiness.downstream_allowed ? 'Có thể chuyển sang Content & Creative.' : 'Cần người phụ trách duyệt trước khi publish.'}</span></div>
            ${readiness.blockers?.length ? `<div class="readiness-blockers">${readiness.blockers.map(item => `<div>• ${escapeHtml(item)}</div>`).join('')}</div>` : ''}
            <h3>Thông tin còn thiếu (${missing.length})</h3>${renderMissing(missing)}
            <h3>Field evidence (${evidence.length})</h3>${renderEvidence(evidence)}
            ${warnings.length ? `<h3>Warnings</h3><div class="warning-list">${warnings.map(item => `<div class="warning-item">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
          </div>
        </details>
      </section>

      <section class="panel knowledge-section full debug-section">
        <div class="eyebrow">Debug & export</div>
        <h2>Structured JSON</h2>
        <details class="raw-json"><summary>Xem Product Knowledge JSON</summary><pre>${escapeHtml(JSON.stringify(pk, null, 2))}</pre></details>
      </section>
    </div>`
}

function businessSection(number, title, content, extra = '') {
  return `<section class="panel knowledge-section business-section ${extra}"><div class="business-heading"><span>${number}</span><div><div class="eyebrow">Đề xuất kinh doanh</div><h2>${escapeHtml(title)}</h2></div></div>${content}</section>`
}

function commercePending() {
  return '<div class="commerce-pending">Content đang được tạo tự động sau bước research. Nếu đây là job cũ, dùng nút <strong>Tạo content cho job cũ</strong> ở đầu trang.</div>'
}

function renderMarketingAnalysis(campaign) {
  const groups = [
    ['USP nổi bật', campaign.usp_analysis || campaign.message_pillars || []],
    ['Insight khách hàng', campaign.customer_insights || []],
    ['Pain point', campaign.pain_points || []],
    ['Lợi ích khách hàng', campaign.customer_benefits || campaign.message_pillars || []],
    ['Góc triển khai content', campaign.content_angles || campaign.hooks || []],
    ['Khách hàng mục tiêu', campaign.target_audience || []],
  ]
  return `<div class="marketing-analysis-grid">${groups.map(([title, items]) => `<article><h3>${escapeHtml(title)}</h3>${items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Chưa có dữ liệu đủ tin cậy.</p>'}</article>`).join('')}</div>
    <div class="strategy-strip"><strong>Thông điệp định vị:</strong> ${escapeHtml(campaign.positioning)}</div>
    ${chipGroup('Từ khóa truyền thông', campaign.communication_keywords || [], 'neutral')}`
}

function renderPricing(pk, pkg) {
  const pricing = pkg?.pricing || { market_range: 'Unknown', recommended_price: 'Unknown', rationale: 'Chưa có dữ liệu giá đủ tin cậy.', status: 'unknown' }
  const offers = pk.pricing?.observed_offers || []
  const sourceMap = new Map((pk.sources || []).map(source => [source.id, source]))
  return `<div class="pricing-layout">
    <div class="price-card market"><span>Khoảng giá thị trường quan sát</span><strong class="${pricing.market_range === 'Unknown' ? 'unknown' : ''}">${escapeHtml(pricing.market_range)}</strong></div>
    <div class="price-card recommended"><span>Giá đề xuất tham khảo</span><strong class="${pricing.recommended_price === 'Unknown' ? 'unknown' : ''}">${escapeHtml(pricing.recommended_price)}</strong></div>
  </div>
  <p class="price-rationale">${escapeHtml(pricing.rationale)}</p>
  ${offers.length ? `<div class="price-offers">${offers.map(offer => { const source = sourceMap.get(offer.source_id); return `<div><strong>${escapeHtml(formatMoneyValue(offer.amount, pk.pricing.currency))}</strong><span>${escapeHtml(offer.seller || source?.domain || offer.source_id)}</span></div>` }).join('')}</div>` : '<div class="price-warning">Chưa thu thập được giá đúng model/biến thể. Không nên tự đặt giá từ sản phẩm gần giống.</div>'}`
}

function renderMediaProposal(media, assets) {
  return `<p class="commerce-paragraph">${escapeHtml(media.visual_system)}</p><div class="media-proposal-grid">${media.assets.map((brief, index) => {
    const asset = assets?.find(item => item.slot === brief.slot)
    return `<article class="media-proposal-card">
      <div class="media-preview">${asset ? `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.label)}" loading="lazy">` : `<div><span>${index === 0 ? 'Ảnh bìa' : `Ảnh phụ ${index}`}</span><b>${escapeHtml(brief.headline || brief.label)}</b></div>`}</div>
      <div class="media-copy"><span>${escapeHtml(brief.slot)}</span><h3>${escapeHtml(brief.label)}</h3><strong>${escapeHtml(brief.headline || 'Không dùng headline')}</strong><p><b>Mục tiêu:</b> ${escapeHtml(brief.purpose)}</p><p><b>Bố cục:</b> ${escapeHtml(brief.visual_direction)}</p>${brief.supporting_copy?.length ? `<ul>${brief.supporting_copy.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}<details><summary>Prompt tạo ảnh</summary><div>${escapeHtml(brief.generation_prompt)}</div></details></div>
    </article>`
  }).join('')}</div>`
}

function renderVideoProposal(video) {
  return `<div class="video-intro"><div><span>Thời lượng</span><strong>${video.duration_seconds}s</strong></div><p><strong>${escapeHtml(video.opening_hook)}</strong><br>${escapeHtml(video.concept)}</p></div>
    <div class="storyboard">${video.scenes.map(scene => `<div class="story-scene"><span>${scene.order}</span><div><strong>${escapeHtml(scene.duration_seconds)}s · ${escapeHtml(scene.overlay_text)}</strong><p><b>Cảnh quay:</b> ${escapeHtml(scene.visual)}</p><small><b>Lời đọc:</b> ${escapeHtml(scene.voiceover)}</small></div></div>`).join('')}</div>
    <div class="description-block"><div class="fact-label">Caption video</div><pre>${escapeHtml(video.caption)}</pre></div>`
}

function renderGeneratedAssets(assets) {
  if (!assets?.length) return `<div class="empty-small">Chưa tạo ảnh. ${state.config?.capabilities?.imageGenerationConfigured ? 'Bấm Generate 4 images ở đầu job.' : 'Thêm TOKENROUTER_API_KEY rồi khởi động lại server.'}</div>`
  return `<div class="asset-gallery">${assets.map(asset => `<figure class="asset-card"><a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.label)}" loading="lazy"></a><figcaption><strong>${escapeHtml(asset.label)}</strong><a href="${escapeHtml(asset.url)}" download="${escapeHtml(asset.fileName)}">Download PNG</a></figcaption></figure>`).join('')}</div>`
}

function section(title, content, extra = '') {
  return `<section class="panel knowledge-section ${extra}"><div class="eyebrow">Product knowledge</div><h2>${escapeHtml(title)}</h2>${content}</section>`
}

function fact(label, value) {
  return `<div class="fact"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value ${value === 'Unknown' || String(value).includes('Unknown') ? 'unknown' : ''}">${formatValue(value)}</div></div>`
}

function chipGroup(label, values, style = '') {
  const items = Array.isArray(values) ? values : []
  return `<div class="fact-label" style="margin-top:16px">${escapeHtml(label)}</div><div class="chips">${items.length ? items.map(value => `<span class="chip ${style}">${escapeHtml(value)}</span>`).join('') : '<span class="chip neutral unknown">Unknown</span>'}</div>`
}

function renderSources(sources) {
  if (!sources.length) return '<div class="empty-small">Không có nguồn web khả dụng.</div>'
  return `<div class="source-list">${sources.map(source => `<div class="source-item">
    <div><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><div class="source-meta">${escapeHtml(source.domain)} · ${escapeHtml(source.source_type.replaceAll('_', ' '))} · ${source.retrieval_status === 'snippet_only' ? 'snippet only' : `${Number(source.content_chars || 0).toLocaleString('vi-VN')} chars`}</div></div>
    <div class="source-score">${Math.round(source.reliability_score * 100)}%</div>
  </div>`).join('')}</div>`
}

function renderMissing(items) {
  if (!items.length) return '<div class="empty-small">Không có field quan trọng nào đang thiếu.</div>'
  return `<div class="missing-list">${items.map(item => `<div class="missing-item"><div class="missing-field">${escapeHtml(item.field_path)} · ${escapeHtml(item.priority)}</div><div class="missing-reason">${escapeHtml(item.reason)}</div></div>`).join('')}</div>`
}

function renderEvidence(items) {
  if (!items.length) return '<div class="empty-small">Chưa có evidence record.</div>'
  return `<table class="evidence-table"><thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Sources</th><th>Confidence</th></tr></thead><tbody>${items.map(item => `<tr>
    <td data-label="Field">${escapeHtml(item.field_path)}</td><td data-label="Value">${escapeHtml(item.value_summary)}</td>
    <td data-label="Status"><span class="evidence-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
    <td data-label="Sources">${escapeHtml(item.source_ids?.join(', ') || '—')}</td><td data-label="Confidence">${Math.round(item.confidence * 100)}%</td>
  </tr>`).join('')}</tbody></table>`
}

function previewImage() {
  const file = imageInput.files?.[0]
  if (!file) return resetImagePreview()
  uploadLabel.textContent = file.name
  imagePreview.src = URL.createObjectURL(file)
  imagePreview.classList.remove('hidden')
}

function resetImagePreview() {
  if (imagePreview.src.startsWith('blob:')) URL.revokeObjectURL(imagePreview.src)
  imagePreview.src = ''
  imagePreview.classList.add('hidden')
  uploadLabel.textContent = 'Chọn hoặc kéo ảnh vào đây'
}

function setSubmitting(value) {
  submitButton.disabled = value
  submitButton.firstElementChild.textContent = value ? 'Đang tạo job…' : 'Research product'
}

function showFormError(message) { formError.textContent = message; formError.classList.remove('hidden') }
function hideFormError() { formError.classList.add('hidden') }
function isActive(status) { return ['created', 'analyzing', 'researching', 'synthesizing', 'contenting', 'generating_media'].includes(status) }

function statusLabel(status) {
  return ({ created: 'Created', analyzing: 'Analyzing', researching: 'Researching', synthesizing: 'Synthesizing', contenting: 'Building content', generating_media: 'Generating images', completed: 'Completed', needs_input: 'Needs input', failed: 'Failed' })[status] || status
}

function readinessLabel(status) {
  return ({ blocked: 'Blocked', needs_review: 'Needs review', ready_for_content: 'Ready for content' })[status] || status
}

function formatValue(value) {
  const text = value === undefined || value === null || value === '' ? 'Unknown' : String(value)
  return `<span class="${text === 'Unknown' ? 'unknown' : ''}">${escapeHtml(text)}</span>`
}

function formatDate(value) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function formatTime(value) { return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value)) }
function formatMoneyValue(amount, currency = 'VND') {
  try { return new Intl.NumberFormat('vi-VN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount) }
  catch { return `${new Intl.NumberFormat('vi-VN').format(amount)} ${currency}` }
}
function relativeTime(value) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000)
  if (Math.abs(minutes) < 1) return 'vừa xong'
  if (Math.abs(minutes) < 60) return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(hours, 'hour')
  return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(Math.round(hours / 24), 'day')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

async function api(path, options = {}) {
  const response = await fetch(path, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`)
  return payload
}
