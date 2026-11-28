const fs = require('fs')
const path = require('path')
const http = require('http')
const { execSync } = require('child_process')

// ========================================
// TỰ ĐỘNG KIỂM TRA & CÀI ĐẶT THƯ VIỆN NẾU THIẾU
// ========================================
const REQUIRED_MODULES = ['mineflayer', 'discord.js', 'socks', 'minecraft-protocol', 'prismarine-nbt']
const missingModules = REQUIRED_MODULES.filter((mod) => {
    try {
        require.resolve(mod)
        return false
    } catch (_) {
        return true
    }
})

if (missingModules.length > 0) {
    console.log(`\x1b[93m[SYSTEM] Phát hiện thiếu thư viện: ${missingModules.join(', ')}\x1b[0m`)
    console.log(`\x1b[96m[SYSTEM] Đang tự động tải & cài đặt qua npm (vui lòng đợi)...\x1b[0m`)
    try {
        execSync(`npm install ${missingModules.join(' ')} --no-audit --no-fund`, { stdio: 'inherit', cwd: __dirname })
        console.log(`\x1b[92m[SYSTEM] Đã cài đặt xong toàn bộ thư viện!\x1b[0m\n`)
    } catch (err) {
        console.error(`\x1b[91m[ERROR] Không thể tự động cài đặt thư viện: ${err.message}\x1b[0m`)
        console.log(`\x1b[93m[HƯỚNG DẪN] Vui lòng chạy thủ công: npm install ${missingModules.join(' ')}\x1b[0m`)
        process.exit(1)
    }
}

const mineflayer = require('mineflayer')
const readline = require('readline')
const nbt = require('prismarine-nbt')
const mcProtocol = require('minecraft-protocol')
const { Client, GatewayIntentBits, EmbedBuilder, Events, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
let SocksClient = null
try {
    SocksClient = require('socks').SocksClient
} catch (_) {
    // socks chưa được cài đặt (chỉ cần khi muốn dùng Proxy SOCKS5)
}

// Bắt lỗi toàn cục tránh crash tiến trình khi gặp lỗi mạng/thư viện đột xuất
process.on('uncaughtException', (err) => {
    console.log(`\n\x1b[91m[UNCAUGHT ERROR] ${err.message}\x1b[0m`)
})

const IS_RENDER_ENV = Boolean(
    process.env.RENDER ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_SERVICE_ID ||
    process.env.AUTO_START ||
    !process.stdin.isTTY
)

const rl = process.stdin.isTTY
    ? readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })
    : null

// ========================================
// MÃ MÀU ANSI CHO TERMINAL
// ========================================

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[91m'
const GREEN = '\x1b[92m'
const YELLOW = '\x1b[93m'
const BLUE = '\x1b[94m'
const MAGENTA = '\x1b[95m'
const CYAN = '\x1b[96m'

// Bảng màu phân biệt cho từng tài khoản
const COLORS = [
    '\x1b[91m', // Red (Acc 1 - _Mahiiru_)
    '\x1b[33m', // Yellow (Acc 2 - dogiabao1234)
    '\x1b[36m', // Cyan (Acc 3 - _Mahiruu_)
    '\x1b[94m', // Bright Blue (Acc 4 - duykhang286)
    '\x1b[35m', // Magenta (Acc 5)
    '\x1b[32m', // Green (Acc 6)
]

// ========================================
// CẤU HÌNH HỆ THỐNG
// ========================================

const RECONNECT_DELAY = 5000
const MENU_COOLDOWN = 8000 // Cooldown 8s giữa các lần gửi /menu tránh spam
const MAINTENANCE_PAUSE_MINUTES = parseInt(process.env.MAINTENANCE_WAIT_MINUTES || '', 10) || 30
const MAINTENANCE_PAUSE_MS = MAINTENANCE_PAUSE_MINUTES * 60 * 1000 // Mặc định nghỉ 30 phút khi server bảo trì

// Mặc định 1.20.1 - phiên bản ổn định nhất tương thích hoàn toàn với hệ thống chống bot KingMC (Velocity)
let MC_VERSION = (process.env.MC_VERSION || '1.20.1').trim()

// Cấu hình Proxy SOCKS5 toàn cục (nếu có)
let currentProxy = null

function parseProxyString(input) {
    if (!input || typeof input !== 'string') return null
    let str = input.trim()
    if (!str) return null

    // Đổi dấu gạch đứng '|' thành ':' nếu dán từ một số trang bán proxy
    if (str.includes('|')) {
        str = str.replace(/\|+/g, ':')
    }

    const lower = str.toLowerCase()
    if (['off', 'xoa', 'xóa', 'none', 'clear', 'tat', 'tắt', 'disable', 'huy', 'hủy', '0'].includes(lower)) {
        return { disabled: true }
    }

    // Nếu dán link URL socks5://user:pass@ip:port
    if (str.includes('://')) {
        try {
            const url = new URL(str)
            return {
                host: url.hostname,
                port: parseInt(url.port) || 1080,
                userId: url.username ? decodeURIComponent(url.username) : undefined,
                password: url.password ? decodeURIComponent(url.password) : undefined
            }
        } catch (_) {
            str = str.replace(/^[a-zA-Z0-9]+:\/\//, '')
        }
    }

    // Định dạng tiêu chuẩn IP:Port:User:Pass hoặc IP:Port
    const parts = str.split(':')
    if (parts.length >= 4) {
        const host = parts[0].trim()
        const port = parseInt(parts[1].trim())
        const userId = parts[2].trim()
        const password = parts.slice(3).join(':').trim()
        if (host && !isNaN(port) && port > 0 && port <= 65535) {
            return {
                host,
                port,
                userId: userId || undefined,
                password: password || undefined
            }
        }
    } else if (parts.length === 2) {
        const host = parts[0].trim()
        const port = parseInt(parts[1].trim())
        if (host && !isNaN(port) && port > 0 && port <= 65535) {
            return {
                host,
                port
            }
        }
    }

    return null
}

if (process.env.MC_PROXY) {
    const envProxy = parseProxyString(process.env.MC_PROXY)
    if (envProxy && !envProxy.disabled) {
        currentProxy = envProxy
    }
}


// ========================================
// DANH SÁCH ACCOUNTS & PROFILE RENDER
// ========================================

const BOT_PROFILE = (process.env.BOT_PROFILE || 'render1').trim().toLowerCase()
const PROFILES = {
    render1: {
        label: 'Render #1',
        configFile: 'discord_render_config.json',
        channelNames: ['bot-discord-render', 'bot-render'],
        ignoreChannelKeywords: ['vps', 'oppo', 'render-2', 'render-3'],
        allowSetChannelKeywords: ['bot-discord-render'],
        accounts: [
            { username: 'duykhang286', password: 'khang2006k' },
            { username: 'mahira01', password: 'khang2006k' },
            { username: 'mahira02', password: 'khang2006k' }
        ]
    },
    oppo: {
        label: 'Render (Oppo)',
        configFile: 'discord_render_oppo_config.json',
        channelNames: ['bot-discord-oppo', 'bot-oppo'],
        ignoreChannelKeywords: ['vps', 'bot-discord-render', 'render-2', 'render-3'],
        allowSetChannelKeywords: ['oppo'],
        accounts: [
            { username: '_Mahiruu_', password: 'khang2006k' },
            { username: '_Mahiruuu_', password: 'khang2006k' }
        ]
    },
    render2: {
        label: 'Render #2 (mahira01)',
        configFile: 'discord_render_2_config.json',
        channelNames: ['bot-discord-render-2', 'bot-render-2'],
        ignoreChannelKeywords: ['vps', 'oppo', 'bot-discord-render', 'render-3'],
        allowSetChannelKeywords: ['render-2'],
        accounts: [
            { username: 'mahira01', password: 'khang2006k' }
        ]
    },
    render3: {
        label: 'Render #3 (mahira02)',
        configFile: 'discord_render_3_config.json',
        channelNames: ['bot-discord-render-3', 'bot-render-3'],
        ignoreChannelKeywords: ['vps', 'oppo', 'bot-discord-render', 'render-2'],
        allowSetChannelKeywords: ['render-3'],
        accounts: [
            { username: 'mahira02', password: 'khang2006k' }
        ]
    }
}
const activeProfile = PROFILES[BOT_PROFILE] || PROFILES.render1

let accounts = activeProfile.accounts.map(a => ({ ...a }))

if (process.env.MC_ACCOUNTS) {
    try {
        const parsedAccounts = JSON.parse(process.env.MC_ACCOUNTS)
        if (Array.isArray(parsedAccounts) && parsedAccounts.length > 0) {
            const valid = parsedAccounts.filter(a => a && a.username && a.password)
            if (valid.length > 0) accounts = valid
        }
    } catch (_) {}
}


// ========================================
// TIỆN ÍCH THỜI GIAN & COMPONENT TEXT
// ========================================

function getTime() {
    const now = new Date()
    return now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    })
}

function getText(obj) {
    if (obj === null || obj === undefined) return ''

    if (obj.type && obj.value && typeof obj.value === 'object') {
        try {
            obj = nbt.simplify(obj)
        } catch (_) { }
    }

    if (typeof obj === 'string') {
        if (obj.startsWith('{') || obj.startsWith('[')) {
            try {
                const parsed = JSON.parse(obj)
                return getText(parsed)
            } catch (_) {
                return obj
            }
        }
        return obj
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
        return String(obj)
    }

    // Các thành phần token trong cùng 1 component thì nối liền (inline)
    if (Array.isArray(obj)) {
        return obj.map(getText).join('')
    }

    if (typeof obj === 'object') {
        let result = ''
        if (obj[''] !== undefined) result += getText(obj[''])
        if (obj.text) result += getText(obj.text)
        if (obj.value !== undefined) result += getText(obj.value)
        if (obj.extra) result += getText(obj.extra)
        return result
    }

    return ''
}

function clearCurrentLine() {
    try {
        if (process.stdout.isTTY) {
            readline.cursorTo(process.stdout, 0)
            readline.clearLine(process.stdout, 0)
        } else {
            process.stdout.write('\r\x1b[2K')
        }
    } catch (_) {
        process.stdout.write('\r\x1b[2K')
    }
}

function formatMinecraftColor(str) {
    if (!str) return ''
    const colorMap = {
        '0': '\x1b[30m', '1': '\x1b[34m', '2': '\x1b[32m', '3': '\x1b[36m',
        '4': '\x1b[31m', '5': '\x1b[35m', '6': '\x1b[33m', '7': '\x1b[37m',
        '8': '\x1b[90m', '9': '\x1b[94m', 'a': '\x1b[92m', 'b': '\x1b[96m',
        'c': '\x1b[91m', 'd': '\x1b[95m', 'e': '\x1b[93m', 'f': '\x1b[97m',
        'l': '\x1b[1m', 'm': '\x1b[9m', 'n': '\x1b[4m', 'o': '\x1b[3m',
        'r': '\x1b[0m'
    }
    const res = str.replace(/§([0-9a-fk-or])/gi, (match, code) => {
        return colorMap[code.toLowerCase()] || ''
    }).replace(/§./g, '')
    return res + RESET
}

function stripAnsi(str) {
    if (typeof str !== 'string') return ''
    return str
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\].*?\x07/g, '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/§./g, '')
        .trim()
}


// ========================================
// CHUẨN HÓA SMALL CAPS, TEXT & TRÍCH XUẤT GUI
// ========================================

const SMALL_CAPS_MAP = {
    'đ': 'd', 'Đ': 'd',
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'Ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o',
    'ᴘ': 'p', 'ǫ': 'q', 'ʀ': 'r', 'Ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v',
    'ᴡ': 'w', 'x': 'x', 'ʏ': 'y', 'ᴢ': 'z'
}
const SMALL_CAPS_REGEX = /[đĐᴀʙᴄᴅᴇғɢʜɪꞮᴊᴋʟᴍɴᴏᴘǫʀƦꜱᴛᴜᴠᴡxʏᴢ]/gu

function cleanMinecraftText(text) {
    if (!text) return ''
    return String(text)
        .replace(/§x(§[0-9a-f]){6}/gi, '')
        .replace(/&x(&[0-9a-f]){6}/gi, '')
        .replace(/&#[0-9a-f]{6}/gi, '')
        .replace(/§#[0-9a-f]{6}/gi, '')
        .replace(/§[0-9a-fk-or]/gi, '')
        .replace(/&[0-9a-fk-or]/gi, '')
        .replace(/§./g, '')
        .replace(/[\u00A0\u200B\uFEFF]/g, ' ')
        .normalize('NFC')
        .trim()
}

function normalizeSmallCaps(str) {
    if (!str) return ''
    return String(str)
        .replace(SMALL_CAPS_REGEX, ch => SMALL_CAPS_MAP[ch] || ch)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
}

function smallCapsToStandardUpper(str) {
    if (!str) return ''
    return String(str)
        .replace(SMALL_CAPS_REGEX, ch => (SMALL_CAPS_MAP[ch] || ch).toUpperCase())
        .toUpperCase()
        .trim()
}

function cleanBuyerName(str) {
    if (!str) return 'Ẩn danh'
    let cleanText = cleanMinecraftText(str)
    const normalized = normalizeSmallCaps(cleanText)

    const prefixMatch = normalized.match(/^(?:don\s*hang|order)?(?:\s*(?:cua|of))?[\s:\-#]*/iu)
    if (prefixMatch && prefixMatch[0].length > 0) {
        const buyerPart = cleanText.substring(prefixMatch[0].length).replace(/^[:\-\s#]+/, '').trim()
        if (buyerPart) return buyerPart
    }

    cleanText = cleanText
        .replace(/^(?:đơn\s*hàng|don\s*hang|order)?(?:\s*(?:của|cua|of))?[\s:\-#]*/iu, '')
        .replace(/^[:\-\s#]+/, '')
        .trim()
    return cleanText || 'Ẩn danh'
}

function formatItemDisplayName(id) {
    if (!id) return 'Item'
    return String(id)
        .replace(/^minecraft:/i, '')
        .split('_')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
}

function isDecorationGuiItem(itemMeta) {
    const nameLower = (itemMeta.name || '').toLowerCase()
    const cleanDisplay = cleanMinecraftText(itemMeta.displayName || '')
    if (nameLower.includes('glass_pane') || nameLower === 'air' || nameLower === 'barrier') return true
    if (!cleanDisplay) return true
    if (itemMeta.loreLines.length === 0 && (nameLower.includes('pane') || nameLower.includes('stained'))) return true
    return false
}

function getStatsLabel(itemMeta) {
    const lower = cleanMinecraftText(itemMeta.displayName || '').toLowerCase()
    const norm = normalizeSmallCaps(cleanMinecraftText(itemMeta.displayName || ''))
    if (lower.includes('tiền') || norm.includes('tien') || norm.includes('xu') || norm.includes('money') || norm.includes('coin')) return 'Tài chính'
    if (norm.includes('shard') || lower.includes('ngôi sao') || lower.includes('★')) return 'Shards'
    if (norm.includes('kill') || lower.includes('giết') || lower.includes('hạ gục')) return 'Kills'
    if (norm.includes('death') || lower.includes('chết')) return 'Deaths'
    if (norm.includes('thoi gian') || norm.includes('time') || lower.includes('giờ') || norm.includes('playtime')) return 'Thời gian chơi'
    if (norm.includes('rank') || norm.includes('danh hieu') || norm.includes('level')) return 'Rank/Cấp độ'
    return cleanMinecraftText(itemMeta.displayName || '') || 'Thông tin'
}

function getItemMeta(item) {
    if (!item) return { name: '', count: 0, displayName: '', loreLines: [] }
    let displayName = item.displayName || item.name || ''

    if (item.customName) {
        const text = getText(item.customName).trim()
        if (text) displayName = text
    } else if (item.componentMap && item.componentMap.has('custom_name')) {
        const customName = item.componentMap.get('custom_name')
        const text = getText(customName?.data).trim()
        if (text) displayName = text
    } else if (item.nbt?.value?.display?.value?.Name?.value) {
        const text = getText(item.nbt.value.display.value.Name.value).trim()
        if (text) displayName = text
    }

    displayName = String(displayName).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

    let loreData = null
    if (item.customLore) {
        loreData = item.customLore
    } else if (item.componentMap && item.componentMap.has('lore')) {
        loreData = item.componentMap.get('lore')?.data
    } else {
        const root = item.nbt?.value || item.nbt
        const displayVal = root?.display?.value || root?.display
        const rawLore = displayVal?.lore || displayVal?.Lore || root?.['minecraft:lore'] || root?.lore
        if (rawLore !== undefined && rawLore !== null) {
            let inner = rawLore.value !== undefined ? rawLore.value : rawLore
            if (inner && inner.value !== undefined) inner = inner.value
            loreData = inner
        }
    }

    const loreLines = []
    if (loreData) {
        const entries = Array.isArray(loreData) ? loreData : [loreData]
        for (const entry of entries) {
            const str = getText(entry).trim()
            if (str) {
                for (const sub of str.split('\n')) {
                    const cleaned = sub.trim()
                    if (cleaned) loreLines.push(cleaned)
                }
            }
        }
    }

    return {
        name: item.name || '',
        count: item.count || 1,
        displayName,
        loreLines
    }
}

function extractTextureIdFromUrl(urlStr) {
    if (!urlStr) return null
    const m = String(urlStr).match(/texture\/([a-f0-9]{32,64})/i)
    return m ? m[1] : null
}

function scanObjectForSkinTextureId(obj, depth = 0) {
    if (!obj || depth > 16) return null
    if (typeof obj === 'string') {
        if (obj.length > 24 && obj.length < 2048) {
            try {
                const decoded = Buffer.from(obj.trim(), 'base64').toString('utf8')
                if (decoded.includes('SKIN') && decoded.includes('textures.minecraft.net')) {
                    const parsed = JSON.parse(decoded)
                    const texId = extractTextureIdFromUrl(parsed?.textures?.SKIN?.url)
                    if (texId) return texId
                }
            } catch (_) { }
        }
        return null
    }
    if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            const res = scanObjectForSkinTextureId(obj[key], depth + 1)
            if (res) return res
        }
    }
    return null
}

function getPlayerAvatarUrl(botInstance, playerName, guiItems = []) {
    const cleanName = String(playerName || '').trim()
    if (!cleanName) return 'https://mc-heads.net/head/MHF_Steve/3d'

    const bot = botInstance?.bot
    if (bot?.players) {
        const targetLower = cleanName.toLowerCase()
        for (const [uname, p] of Object.entries(bot.players)) {
            if ((uname.toLowerCase() === targetLower || p?.username?.toLowerCase() === targetLower) && p?.skinData?.url) {
                const texId = extractTextureIdFromUrl(p.skinData.url)
                if (texId) return `https://mc-heads.net/head/${texId}/3d`
            }
        }
    }

    for (const item of guiItems) {
        if (!item) continue
        const nbtId = scanObjectForSkinTextureId(item.nbt) || (item.componentMap ? scanObjectForSkinTextureId(item.componentMap.get('profile')) : null)
        if (nbtId) return `https://mc-heads.net/head/${nbtId}/3d`
    }

    return `https://mc-heads.net/head/${encodeURIComponent(cleanName)}/3d`
}


// ========================================
// ĐỊNH DẠNG LORE RÚT GỌN (CÁCH 1)
// ========================================

function formatItemLore(lines) {
    if (!lines || lines.length === 0) return []

    // Lọc bỏ các dòng hướng dẫn bấm thừa thãi lặp lại (hỗ trợ cả Small Caps)
    const cleanLines = lines.filter(line => {
        const norm = normalizeSmallCaps(cleanMinecraftText(line))
        return !norm.includes('bam vao de') &&
            !norm.includes('nhap vao de') &&
            !norm.includes('click to')
    })

    let isOrder = false
    let soLuong = ''
    let gia = ''
    let daGiao = ''
    let daThanhToan = ''
    const otherLines = []

    for (const line of cleanLines) {
        const clean = cleanMinecraftText(line)
        const norm = normalizeSmallCaps(clean)
        const colonIdx = clean.indexOf(':')
        const val = colonIdx !== -1 ? clean.slice(colonIdx + 1).trim() : clean.trim()

        if (norm.includes('so luong')) {
            isOrder = true
            soLuong = val
        } else if (norm.includes('gia moi item') || norm.includes('gia:')) {
            isOrder = true
            gia = val
        } else if (norm.includes('da giao')) {
            isOrder = true
            daGiao = val
        } else if (norm.includes('da thanh toan')) {
            isOrder = true
            daThanhToan = val
        } else {
            otherLines.push(clean)
        }
    }

    // Nếu là đơn hàng (/order): Gộp thành 2 dòng súc tích theo Cách 1
    if (isOrder) {
        const result = []
        if (soLuong || gia) {
            result.push(`• Số lượng: ${soLuong || 'N/A'}${gia ? ` | Giá: ${gia}/item` : ''}`)
        }
        if (daGiao || daThanhToan) {
            result.push(`• Đã giao: ${daGiao || '0'}${daThanhToan ? ` (${daThanhToan})` : ''}`)
        }
        for (const o of otherLines) {
            result.push(`• ${o}`)
        }
        return result
    }

    // Nếu là menu hoặc AH thông thường: Hiển thị gọn gàng từng dòng
    return cleanLines.map(l => `• ${cleanMinecraftText(l)}`)
}


// ========================================
// HIỂN THỊ GUI & PARSER /order, /ah, /stats
// ========================================

function parseOrderWindowSlots(window, itemQuery = '') {
    if (!window || !window.slots) return []
    const normalizedQuery = normalizeSmallCaps(String(itemQuery || '').trim()).replace(/[\s_\-]+/g, '')
    const isBoneQuery = (normalizedQuery === 'bone' || normalizedQuery === 'xuong')
    const isBoneBlockQuery = (normalizedQuery === 'boneblock' || normalizedQuery === 'khoixuong')
    const maxSlots = Math.min(45, window.inventoryStart || 45, window.slots.length)
    const orders = []

    for (let i = 0; i < maxSlots; i++) {
        const item = window.slots[i]
        if (!item) continue
        const nameLower = (item.name || '').toLowerCase()
        if (nameLower.includes('pane') || nameLower === 'air' || nameLower === 'barrier') continue
        if (isBoneQuery && nameLower !== 'bone') continue
        if (isBoneBlockQuery && nameLower !== 'bone_block') continue

        const meta = getItemMeta(item)
        if (meta.loreLines.length === 0) continue

        const cleanDisplay = cleanMinecraftText(meta.displayName)
        const buyer = cleanBuyerName(cleanDisplay)

        let quantity = ''
        let price = ''
        let delivered = ''
        let paid = ''

        for (const line of meta.loreLines) {
            const cleanLine = cleanMinecraftText(line).trim()
            const normLine = normalizeSmallCaps(cleanLine)

            if (!delivered && normLine.includes('da giao')) {
                if (cleanLine.includes(':')) {
                    delivered = cleanLine.split(':').slice(1).join(':').trim()
                } else {
                    const m = cleanLine.match(/(\d[\d,\.]*\s*\/\s*\d[\d,\.]*)/)
                    if (m) delivered = m[1].replace(/\s+/g, '')
                }
            }

            if (!paid && normLine.includes('da thanh toan') && cleanLine.includes(':')) {
                paid = cleanLine.split(':').slice(1).join(':').trim()
            }

            if (!quantity && (normLine.includes('so luong') || normLine.includes('sl:') || normLine.includes('can mua'))) {
                quantity = cleanLine.includes(':')
                    ? cleanLine.split(':').slice(1).join(':').trim()
                    : cleanLine.replace(/^.*?(?:số\s*lượng|so\s*luong|cần\s*mua|sl)\s*/iu, '').trim()
            }

            if (!price && ((normLine.includes('gia') && !normLine.includes('giao')) || cleanLine.includes('$'))) {
                if (cleanLine.includes(':')) {
                    price = cleanLine.split(':').slice(1).join(':').trim()
                } else if (cleanLine.includes('$')) {
                    price = cleanLine.substring(cleanLine.indexOf('$')).trim()
                }
            }
        }

        let remaining = null
        if (delivered) {
            const parts = delivered.replace(/,/g, '').split('/')
            if (parts.length === 2) {
                const delivNum = parseInt(parts[0], 10)
                const totalNum = parseInt(parts[1], 10)
                if (!isNaN(delivNum) && !isNaN(totalNum)) {
                    remaining = Math.max(0, totalNum - delivNum)
                }
            }
        }
        if (remaining === null && quantity) {
            const m = quantity.replace(/,/g, '').match(/\d+/)
            if (m) remaining = parseInt(m[0], 10)
        }

        orders.push({
            slot: i,
            itemName: item.name,
            displayName: meta.displayName,
            buyer: buyer || 'Ẩn danh',
            quantity: quantity || (remaining !== null ? String(remaining) : String(meta.count || 1)),
            remaining: remaining !== null ? String(remaining) : null,
            price: price || 'N/A',
            delivered: delivered || null,
            paid: paid || null
        })
    }

    return orders
}

function parseAhWindowSlots(window) {
    if (!window || !window.slots) return []
    const maxSlots = Math.min(45, window.inventoryStart || 45, window.slots.length)
    const items = []

    for (let i = 0; i < maxSlots; i++) {
        const item = window.slots[i]
        if (!item) continue
        const nameLower = (item.name || '').toLowerCase()
        if (nameLower.includes('pane') || nameLower === 'air' || nameLower === 'barrier') continue

        const meta = getItemMeta(item)
        if (meta.loreLines.length === 0) continue

        let price = ''
        let seller = ''
        let expiration = ''
        let quantity = ''

        for (const line of meta.loreLines) {
            const cleanLine = cleanMinecraftText(line).trim()
            const normLine = normalizeSmallCaps(cleanLine)

            if (!quantity && (normLine.includes('so luong') || normLine.includes('sl:'))) {
                quantity = cleanLine.includes(':')
                    ? cleanLine.split(':').slice(1).join(':').trim()
                    : cleanLine.replace(/^.*?(?:số\s*lượng|so\s*luong|sl)\s*/iu, '').trim()
            }

            if (!price && (normLine.includes('gia') || cleanLine.includes('$'))) {
                if (cleanLine.includes(':')) {
                    price = cleanLine.split(':').slice(1).join(':').trim()
                } else if (cleanLine.includes('$')) {
                    price = cleanLine.substring(cleanLine.indexOf('$')).trim()
                }
            }

            if (!seller && (normLine.includes('nguoi ban') || normLine.includes('seller')) && cleanLine.includes(':')) {
                seller = cleanLine.split(':').slice(1).join(':').trim()
            }

            if (!expiration && (normLine.includes('het han') || normLine.includes('expire')) && cleanLine.includes(':')) {
                expiration = cleanLine.split(':').slice(1).join(':').trim()
            }
        }

        items.push({
            slot: i,
            itemName: item.name,
            displayName: meta.displayName,
            quantity: quantity || String(meta.count || 1),
            price: price || 'N/A',
            seller: seller || 'Ẩn danh',
            expiration: expiration || null
        })
    }

    return items
}

function parseStatsWindowSlots(window) {
    if (!window || !window.slots) return { statsEntries: [], rawSlots: [] }
    const maxSlots = Math.min(window.inventoryStart || 54, window.slots.length)
    const statsEntries = []
    const rawSlots = []

    for (let i = 0; i < maxSlots; i++) {
        const item = window.slots[i]
        if (!item) continue
        rawSlots.push(item)

        const meta = getItemMeta(item)
        if (isDecorationGuiItem(meta)) continue

        const rawCleanDisplay = cleanMinecraftText(meta.displayName)
        const convertedTitle = smallCapsToStandardUpper(rawCleanDisplay)
        const displayTitle = (convertedTitle || getStatsLabel(meta)).trim()

        const cleanLore = meta.loreLines
            .map(l => cleanMinecraftText(l))
            .filter(line => {
                if (!line) return false
                if (/^[_\-+=*~]+$/.test(line)) return false
                if (line.includes('------') || line.includes('======') || line.includes('______')) return false
                const norm = normalizeSmallCaps(line)
                if (norm.includes('nhap') || norm.includes('bam') || norm.includes('click')) return false
                return true
            })

        const valueText = cleanLore.join(', ')
        if (valueText) {
            statsEntries.push({
                title: displayTitle,
                value: valueText,
                itemName: meta.name
            })
        }
    }

    return { statsEntries, rawSlots }
}

function showWindowItems(window, color = '', username = '') {
    const prefix = color ? `${color}[${username}]${RESET} ` : ''
    const titleText = getText(window.title) || 'Không tên'

    // Nếu đây là túi đồ cá nhân của bot -> Ẩn hoàn toàn không hiển thị
    if (window.type === 'minecraft:inventory') {
        return
    }

    let maxSlots = 0
    if (window.inventoryStart !== undefined && window.inventoryStart > 0) {
        maxSlots = window.inventoryStart
    } else if (window.slots.length >= 81) {
        maxSlots = 54
    } else if (window.slots.length >= 63) {
        maxSlots = 27
    } else {
        maxSlots = Math.min(window.slots.length, 54)
    }

    if (typeof commandLineActive !== 'undefined' && commandLineActive) {
        clearCurrentLine()
    }

    console.log('')
    console.log('========================================')
    console.log(`  ${prefix}GUI HIỆN TẠI: ${titleText}`)
    console.log('========================================')

    for (let i = 0; i < maxSlots; i++) {
        const item = window.slots[i]
        if (!item) continue

        const hasCustomName = Boolean(item.customName || (item.componentMap && item.componentMap.has('custom_name')))
        const hasLore = Boolean(item.customLore || (item.componentMap && item.componentMap.has('lore')))
        if (item.name.includes('stained_glass_pane') && !hasCustomName && !hasLore) {
            continue
        }

        try {
            const meta = getItemMeta(item)
            const countStr = meta.count > 1 ? `x${meta.count} ` : ''
            console.log(`[SLOT ${i}] ${countStr}${meta.displayName} (${meta.name})`)

            if (meta.loreLines.length > 0) {
                const formattedLore = formatItemLore(meta.loreLines)
                for (const line of formattedLore) {
                    console.log(`         ${line}`)
                }
            }
        } catch (itemErr) {
            console.log(`[SLOT ${i}] ${item.name} (Lỗi đọc item: ${itemErr.message})`)
        }
    }

    console.log('========================================')
    console.log(`Nhập: click <slot> (hoặc <số bot> click <slot>)`)
    console.log(`Nhập: close để đóng GUI`)
    console.log('========================================')
    console.log('')
    if (typeof commandLineActive !== 'undefined' && commandLineActive) {
        updatePrompt()
    }
}


// ========================================
// NHẬN BIẾT TIN NHẮN TỪ SẢNH (LOBBY) & KINGSMP
// ========================================

function isLobbyMessage(cleanLower) {
    if (
        cleanLower.includes('server còn mới nên nếu có') ||
        cleanLower.includes('server con moi nen neu co') ||
        cleanLower.includes('góp ý hay lỗi gì bạn hãy') ||
        cleanLower.includes('gop y hay loi gi ban hay') ||
        cleanLower.includes('báo cho admin tại discord') ||
        cleanLower.includes('bao cho admin tai discord') ||
        cleanLower.includes('không được phép bán các vật phẩm') ||
        cleanLower.includes('khong duoc phep ban cac vat pham') ||
        cleanLower.includes('trong server sang tiền thật') ||
        cleanLower.includes('trong server sang tien that') ||
        cleanLower.includes('điều này là bị cấm') ||
        cleanLower.includes('dieu nay la bi cam') ||
        cleanLower.includes('server nghiêm cấm mọi hành vi') ||
        cleanLower.includes('server nghiem cam moi hanh vi') ||
        cleanLower.includes('nếu bị phát hiện sẽ phạt theo luật') ||
        cleanLower.includes('neu bi phat hien se phat theo luat') ||
        cleanLower.includes('hãy là 1 người chơi văn minh') ||
        cleanLower.includes('hay la 1 nguoi choi van minh') ||
        cleanLower === 'hack cheat'
    ) {
        return true
    }

    if (
        cleanLower.includes('sảnh ➞') ||
        cleanLower.includes('sanh ➞')
    ) {
        return true
    }

    return false
}

function isKingSMPMessage(cleanLower) {
    return (
        cleanLower.includes('bạn có $') ||
        cleanLower.includes('ban co $') ||
        cleanLower.includes('đơn hàng chưa lấy') ||
        cleanLower.includes('don hang chua lay') ||
        cleanLower.includes('/warp crate') ||
        cleanLower.includes('/donate') ||
        cleanLower.includes('donate key') ||
        cleanLower.includes('rank plus') ||
        cleanLower.includes('/rtp') ||
        cleanLower.includes('keyfree') ||
        cleanLower.includes('xây căn cứ') ||
        cleanLower.includes('xay can cu') ||
        cleanLower.includes('/commands') ||
        cleanLower.includes('lạm phát') ||
        cleanLower.includes('lam phat') ||
        cleanLower.includes('dưới 180 phút') ||
        cleanLower.includes('duoi 180 phut') ||
        cleanLower.includes('/key')
    )
}

function isMaintenanceMessage(text) {
    if (!text) return false
    const norm = normalizeSmallCaps(cleanMinecraftText(text))
    return (
        norm.includes('may chu bao tri') ||
        norm.includes('server bao tri') ||
        norm.includes('bao tri dinh ky') ||
        (norm.includes('bao tri') && norm.includes('quay lai')) ||
        (norm.includes('4h30') && (norm.includes('5h') || norm.includes('bao tri'))) ||
        norm.includes('khoi dong lai may chu') ||
        norm.includes('may chu khoi dong lai')
    )
}


// ========================================
// HỖ TRỢ PRE-PING STATUS CHO HỆ THỐNG CHỐNG BOT (VELOCITY)
// ========================================

function prePingServer(proxy, version, callback) {
    let finished = false
    const done = () => {
        if (!finished) {
            finished = true
            callback()
        }
    }
    const timer = setTimeout(done, 2500)

    try {
        const pingOpts = {
            host: 'kingmc.vn',
            port: 25565,
            version: version || MC_VERSION,
            closeTimeout: 2000
        }

        if (proxy && !proxy.disabled && SocksClient) {
            pingOpts.connect = (client) => {
                const socksOptions = {
                    proxy: {
                        host: proxy.host,
                        port: proxy.port,
                        type: 5
                    },
                    command: 'connect',
                    destination: {
                        host: 'kingmc.vn',
                        port: 25565
                    },
                    timeout: 4000
                }
                if (proxy.userId) socksOptions.proxy.userId = proxy.userId
                if (proxy.password) socksOptions.proxy.password = proxy.password

                SocksClient.createConnection(socksOptions, (err, info) => {
                    if (err) {
                        done()
                        return
                    }
                    client.setSocket(info.socket)
                    client.emit('connect')
                })
            }
        }

        mcProtocol.ping(pingOpts, () => {
            clearTimeout(timer)
            done()
        })
    } catch (_) {
        clearTimeout(timer)
        done()
    }
}


// ========================================
// CLASS QUẢN LÝ TỪNG BOT INSTANCE
// ========================================

class BotInstance {
    constructor(id, account, color, proxy = null) {
        this.id = id // 1, 2, 3, 4...
        this.username = account.username
        this.password = account.password
        this.color = color
        this.proxy = proxy || (currentProxy ? { ...currentProxy } : null)

        this.bot = null
        this.loggedIn = false
        this.inKingSMP = false
        this.reconnecting = false
        this.stoppedManually = false
        this.consecutiveErrors = 0
        this.isVerifyReconnect = false

        this.lastLoginTime = 0
        this.loginPendingTimer = null

        this.lastMenuSentTime = 0
        this.lastMenuClickTime = 0
        this.menuPendingTimer = null
        this.reconnectTimer = null
        this.physicsDisableTimer = null
        this.pendingQuery = null
        this.maintenanceUntil = 0
    }

    setPhysicsEnabled(enabled) {
        if (!this.bot) return
        this.bot.physicsEnabled = Boolean(enabled)
    }

    isInKingSMPReady() {
        if (!this.bot || this.stoppedManually || !this.isChatReady()) return false
        if (this.inKingSMP) return true
        const hasSMPBoard = Boolean(
            this.bot.scoreboards?.['kmsb'] ||
            (this.bot.scoreboard?.sidebar && normalizeSmallCaps(getText(this.bot.scoreboard.sidebar.title)).includes('kingsmp'))
        )
        if (hasSMPBoard) this.inKingSMP = true
        return this.inKingSMP
    }

    rejectPendingQuery(reason) {
        const q = this.pendingQuery
        if (!q) return
        this.pendingQuery = null
        if (q.cleanup) q.cleanup()
        q.reject(new Error(reason))
    }

    log(message, tag = '') {
        const prefix = `${this.color}[${this.username}]${RESET}`
        const fullMsg = tag ? `${prefix} ${tag}${message}${RESET}` : `${prefix} ${message}`
        if (typeof commandLineActive !== 'undefined' && commandLineActive) {
            clearCurrentLine()
            console.log(fullMsg)
            updatePrompt()
        } else {
            console.log(fullMsg)
        }
    }

    markEnteredKingSMP() {
        if (this.inKingSMP) return
        this.inKingSMP = true
        this.log(`[${getTime()}] Đã vào KingSMP`, GREEN)
        sendDiscordAlert('🟢 Đã Vào KingSMP', `Bot **[${this.username}]** đã vào KingSMP thành công!`, 0x2ED573)

        // Tắt physics ticks (50ms) sau khi đã ổn định trong KingSMP để tiết kiệm CPU/RAM khi AFK
        if (this.physicsDisableTimer) clearTimeout(this.physicsDisableTimer)
        this.physicsDisableTimer = setTimeout(() => {
            this.physicsDisableTimer = null
            if (this.bot && this.inKingSMP && !this.stoppedManually) {
                this.setPhysicsEnabled(false)
            }
        }, 2000)
    }

    start() {
        this.stoppedManually = false
        this.loggedIn = false
        this.inKingSMP = false
        this.isVerifyReconnect = false
        this.maintenanceUntil = 0
        this.lastLoginTime = 0
        this.lastMenuSentTime = 0
        this.lastMenuClickTime = 0

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.reconnecting = false
        this.clearTimers()

        // Gửi Pre-Ping Server Status trước khi kết nối để vượt qua kiểm tra Client của Anti-Bot
        prePingServer(this.proxy, MC_VERSION, () => {
            if (this.stoppedManually) return
            this._createBotConnection()
        })
    }

    pauseForMaintenance(reasonText) {
        if (this.stoppedManually) return
        if (this.maintenanceUntil > Date.now() && this.reconnecting) return

        const cleanReason = cleanMinecraftText(reasonText || 'Máy chủ bảo trì').replace(/\s+/g, ' ').trim()
        this.maintenanceUntil = Date.now() + MAINTENANCE_PAUSE_MS
        this.loggedIn = false
        this.inKingSMP = false
        this.rejectPendingQuery('Server đang bảo trì.')
        this.clearTimers()

        this.log(`[BẢO TRÌ] ${cleanReason} -> Tự ngắt kết nối và nghỉ ${MAINTENANCE_PAUSE_MINUTES} phút rồi mới vào lại!`, YELLOW)
        sendDiscordAlert(
            '🛠️ Server Đang Bảo Trì',
            `**[${this.username}]** phát hiện thông báo bảo trì:\n\`\`\`${cleanReason}\`\`\`\n⏳ Bot đã tự ngắt kết nối và nghỉ **${MAINTENANCE_PAUSE_MINUTES} phút** để không spam đăng nhập.`,
            0xFFA502
        )

        this.scheduleReconnect(MAINTENANCE_PAUSE_MS, true)

        if (this.bot) {
            const oldBot = this.bot
            this.bot = null
            try {
                oldBot.quit()
            } catch (_) {
                try { if (oldBot._client) oldBot._client.end() } catch (_) {}
            }
        }
    }

    _createBotConnection() {
        const botOptions = {
            host: 'kingmc.vn',
            port: 25565,
            username: this.username,
            version: MC_VERSION,
            auth: 'offline',
            hideErrors: true,
            viewDistance: 'tiny', // Giảm tải chunk & entities từ KingMC
            physicsEnabled: true, // Bật ở sảnh để tiếp đất & thao tác menu, tự tắt khi đã AFK trong KingSMP
            plugins: {
                particle: false,
                sound: false,
                rain: false,
                ray_trace: false,
                boss_bar: false,
                breath: false,
                digging: false,
                enchantment_table: false,
                fishing: false,
                furnace: false,
                anvil: false,
                villager: false,
                command_block: false
            }
        }

        if (this.proxy && !this.proxy.disabled) {
            botOptions.connect = (client) => {
                const socksOptions = {
                    proxy: {
                        host: this.proxy.host,
                        port: this.proxy.port,
                        type: 5
                    },
                    command: 'connect',
                    destination: {
                        host: 'kingmc.vn',
                        port: 25565
                    },
                    timeout: 15000
                }

                if (this.proxy.userId) {
                    socksOptions.proxy.userId = this.proxy.userId
                }
                if (this.proxy.password) {
                    socksOptions.proxy.password = this.proxy.password
                }

                SocksClient.createConnection(socksOptions, (err, info) => {
                    if (err) {
                        this.log(`[PROXY ERROR] Kết nối Proxy thất bại: ${err.message}`, RED)
                        client.emit('error', new Error(`[Proxy Error] ${err.message}`))
                        this.scheduleReconnect()
                        return
                    }

                    // Đặt timeout 15s nếu proxy không truyền dữ liệu phản hồi từ server Minecraft về
                    info.socket.setTimeout(15000, () => {
                        this.log(`[PROXY TIMEOUT] Server KingMC không phản hồi qua Proxy sau 15s (Proxy có thể bị chặn port 25565 hoặc quá lag)`, RED)
                        info.socket.destroy(new Error('Proxy connection timed out waiting for server data'))
                    })

                    info.socket.once('data', () => {
                        // Khi đã nhận được dữ liệu đầu tiên từ server thì gỡ timeout ban đầu
                        info.socket.setTimeout(0)
                    })

                    client.setSocket(info.socket)
                    client.emit('connect')
                })
            }
        }

        try {
            this.bot = mineflayer.createBot(botOptions)
        } catch (err) {
            this.log(`[CREATE ERROR] ${err.message}`, RED)
            this.scheduleReconnect()
            return
        }

        this.setupEvents()
    }

    stop() {
        this.stoppedManually = true
        this.maintenanceUntil = 0
        this.rejectPendingQuery('Bot đã dừng hoạt động.')
        this.clearTimers()

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.reconnecting = false

        if (this.bot) {
            try {
                this.bot.quit()
            } catch (_) {
                if (this.bot._client) this.bot._client.end()
            }
            this.bot = null
        }

        this.loggedIn = false
        this.inKingSMP = false
        this.log(`[STOP] Bot đã ngắt kết nối và dừng hoạt động.`, YELLOW)
    }

    clearTimers() {
        if (this.loginPendingTimer) {
            clearTimeout(this.loginPendingTimer)
            this.loginPendingTimer = null
        }
        if (this.menuPendingTimer) {
            clearTimeout(this.menuPendingTimer)
            this.menuPendingTimer = null
        }
        if (this.physicsDisableTimer) {
            clearTimeout(this.physicsDisableTimer)
            this.physicsDisableTimer = null
        }
    }

    sendLogin(reason, delayMs = 1000) {
        if (this.loginPendingTimer) return

        this.loggedIn = false
        this.inKingSMP = false
        this.setPhysicsEnabled(true)

        if (this.menuPendingTimer) {
            clearTimeout(this.menuPendingTimer)
            this.menuPendingTimer = null
        }

        this.loginPendingTimer = setTimeout(() => {
            this.loginPendingTimer = null
            if (!this.bot || this.loggedIn) return

            this.bot.chat(`/login ${this.password}`)
            this.lastLoginTime = Date.now()
        }, delayMs)
    }

    requestMenu(reason, delayMs = 3000) {
        const now = Date.now()
        if (now - this.lastMenuSentTime < MENU_COOLDOWN) return
        if (this.menuPendingTimer) return

        this.menuPendingTimer = setTimeout(() => {
            this.menuPendingTimer = null
            if (!this.bot || this.inKingSMP) return

            // Nếu GUI đang mở sẵn và là MENU thì click luôn slot 24 (KingSMP)
            if (this.bot.currentWindow) {
                const title = getText(this.bot.currentWindow.title)
                if (title.toUpperCase().includes('MENU')) {
                    this.lastMenuSentTime = Date.now()
                    this.lastMenuClickTime = Date.now()
                    this.bot.clickWindow(24, 0, 0)
                        .then(() => {
                            this.markEnteredKingSMP()
                        })
                        .catch(err => this.log(`[CLICK ERROR] ${err.message}`, RED))
                    return
                }
            }

            this.lastMenuSentTime = Date.now()
            this.bot.chat('/menu')
        }, delayMs)
    }

    scheduleReconnect(customDelay = null, silentLog = false) {
        if (this.stoppedManually) return
        if (this.reconnecting) return

        this.reconnecting = true

        let delay = customDelay
        if (this.maintenanceUntil > Date.now()) {
            delay = Math.max(delay || 0, this.maintenanceUntil - Date.now())
        }
        if (!delay) {
            if (this.consecutiveErrors >= 3) {
                delay = 30000 // Chờ 30s nếu liên tục lỗi
            } else if (this.consecutiveErrors >= 2) {
                delay = 10000 // Chờ 10s
            } else {
                delay = RECONNECT_DELAY // 5s
            }
        }

        if (!this.isVerifyReconnect && !silentLog) {
            const sec = Math.round(delay / 1000)
            const timeLabel = sec >= 120 ? `${Math.round(sec / 60)} phút` : `${sec}s`
            this.log(`[${getTime()}] Mất kết nối - Thử lại sau ${timeLabel}...`, YELLOW)
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnecting = false
            this.maintenanceUntil = 0
            if (!this.stoppedManually) {
                this.start()
            }
        }, delay)
    }

    isChatReady() {
        return Boolean(this.bot && this.bot._client && typeof this.bot._client.chat === 'function')
    }

    chat(msg) {
        if (!this.isChatReady()) {
            this.log('[ERROR] Bot chưa vào server hoặc chưa sẵn sàng gửi chat/lệnh lúc này!', RED)
            return
        }
        try {
            this.bot.chat(msg)
        } catch (err) {
            this.log(`[SEND ERROR] ${err.message}`, RED)
        }
    }

    click(slot) {
        if (!this.bot || !this.bot.currentWindow) {
            this.log('[ERROR] Không có GUI nào đang mở', RED)
            return
        }
        this.bot.clickWindow(slot, 0, 0)
            .catch(err => this.log(`[CLICK ERROR] ${err.message}`, RED))
    }

    close() {
        if (this.bot && this.bot.currentWindow) {
            this.bot.closeWindow(this.bot.currentWindow)
            this.log('[GUI] Đã đóng GUI')
        } else {
            this.log('[GUI] Không có GUI nào đang mở')
        }
    }

    async runGuiQuery({ type, commandText, query = '', timeoutMs = 15000 }) {
        if (!this.isInKingSMPReady()) {
            throw new Error(`Bot [${this.username}] chưa vào KingSMP hoặc chưa sẵn sàng.`)
        }
        if (this.pendingQuery) {
            throw new Error(`Bot [${this.username}] đang bận xử lý yêu cầu khác.`)
        }

        // Đóng GUI cũ nếu đang mở trước khi chạy truy vấn
        if (this.bot.currentWindow) {
            try { this.bot.closeWindow(this.bot.currentWindow) } catch (_) { }
            await new Promise(r => setTimeout(r, 150))
        }

        return new Promise((resolve, reject) => {
            let finished = false
            let timeoutTimer = null
            let settleTimer = null

            const cleanup = () => {
                if (timeoutTimer) clearTimeout(timeoutTimer)
                if (settleTimer) clearTimeout(settleTimer)
                if (this.bot) {
                    this.bot.removeListener('messagestr', onMessage)
                }
            }

            const doneResolve = (data) => {
                if (finished) return
                finished = true
                if (this.pendingQuery?.type === type) this.pendingQuery = null
                cleanup()
                resolve(data)
            }

            const doneReject = (err) => {
                if (finished) return
                finished = true
                if (this.pendingQuery?.type === type) this.pendingQuery = null
                cleanup()
                reject(err)
            }

            const extractAndClose = (window) => {
                let payload = null
                if (type === 'order') {
                    payload = {
                        botUsername: this.username,
                        title: cleanMinecraftText(getText(window.title || '')),
                        orders: parseOrderWindowSlots(window, query)
                    }
                } else if (type === 'ah') {
                    payload = {
                        botUsername: this.username,
                        title: cleanMinecraftText(getText(window.title || '')),
                        items: parseAhWindowSlots(window)
                    }
                } else if (type === 'stats') {
                    const parsed = parseStatsWindowSlots(window)
                    payload = {
                        botUsername: this.username,
                        title: cleanMinecraftText(getText(window.title || '')),
                        entries: parsed.statsEntries,
                        avatarUrl: getPlayerAvatarUrl(this, query, parsed.rawSlots)
                    }
                }

                if (this.bot && window) {
                    try { this.bot.closeWindow(window) } catch (_) { }
                }
                doneResolve(payload)
            }

            const onWindow = (window) => {
                if (finished) return
                if (settleTimer) clearTimeout(settleTimer)
                const hasItemsNow = (() => {
                    if (type === 'order') return parseOrderWindowSlots(window, query).length > 0
                    if (type === 'ah') return parseAhWindowSlots(window).length > 0
                    if (type === 'stats') return parseStatsWindowSlots(window).statsEntries.length > 0
                    return false
                })()

                if (hasItemsNow) {
                    // Chờ nhẹ 120ms để packet window_items nạp đủ toàn bộ các slot còn lại của trang
                    settleTimer = setTimeout(() => extractAndClose(window), 120)
                } else {
                    // Nếu packet slot tới trễ hơn windowOpen -> chờ 350ms rồi quét lại
                    settleTimer = setTimeout(() => extractAndClose(window), 350)
                }
            }

            const onMessage = (message) => {
                if (finished) return
                const cleanMsg = cleanMinecraftText(message).trim()
                if (!cleanMsg || (cleanMsg.includes('<') && cleanMsg.includes('>'))) return
                const normMsg = normalizeSmallCaps(cleanMsg)

                if (type === 'ah' && (
                    normMsg.includes('khong tim thay vat pham') ||
                    normMsg.includes('khong co vat pham nao')
                )) {
                    doneResolve({ botUsername: this.username, title: 'Chợ Đấu Giá', items: [] })
                    return
                }

                if (type === 'order' && (
                    normMsg.includes('khong tim thay') ||
                    normMsg.includes('khong co don')
                )) {
                    doneResolve({ botUsername: this.username, title: 'Đơn Hàng', orders: [] })
                    return
                }

                if (type === 'stats' && (
                    normMsg.includes('khong tim thay') ||
                    normMsg.includes('chua tung tham gia') ||
                    normMsg.includes('nguoi choi khong hop le') ||
                    normMsg.includes('not found')
                )) {
                    doneResolve({
                        botUsername: this.username,
                        notFound: true,
                        message: cleanMsg,
                        entries: [],
                        avatarUrl: getPlayerAvatarUrl(this, query)
                    })
                }
            }

            this.pendingQuery = { type, query, onWindow, cleanup, reject: doneReject }
            timeoutTimer = setTimeout(() => {
                doneReject(new Error(`Timeout! Server không phản hồi lệnh ${commandText} sau ${Math.round(timeoutMs / 1000)}s.`))
            }, timeoutMs)

            this.bot.on('messagestr', onMessage)
            this.bot.chat(commandText)
        })
    }

    setupEvents() {
        const bot = this.bot

        bot.on('login', () => {
            this.consecutiveErrors = 0
            this.isVerifyReconnect = false
        })

        bot.once('spawn', () => {
            this.setPhysicsEnabled(true)
        })

        bot.on('death', () => {
            this.setPhysicsEnabled(true)
            setTimeout(() => {
                if (this.bot && this.inKingSMP && !this.stoppedManually) {
                    this.setPhysicsEnabled(false)
                }
            }, 3000)
        })

        if (bot._client) {
            bot._client.on('scoreboard_score', (packet) => {
                if (!bot.scoreboards) return
                const scoreboard = bot.scoreboards[packet.scoreName]
                if (scoreboard && (packet.action === 0 || packet.action === undefined)) {
                    const item = scoreboard.add(packet.itemName, packet.value)
                    if (packet.display_name) {
                        item.displayNameOverride = packet.display_name
                    }
                }
            })

            bot._client.on('reset_score', (packet) => {
                if (!bot.scoreboards) return
                const { entity_name, objective_name } = packet
                if (objective_name && bot.scoreboards[objective_name]) {
                    bot.scoreboards[objective_name].remove(entity_name)
                } else {
                    for (const sb of Object.values(bot.scoreboards)) {
                        sb.remove(entity_name)
                    }
                }
            })
        }

        bot.on('messagestr', (message) => {
            if (!message || !message.trim()) return
            this.log(`[CHAT] ${message}`)

            const raw = message || ''
            const lower = raw.toLowerCase()
            const cleanLower = lower.trim()

            // 0. Phát hiện thông báo bảo trì / khởi động lại máy chủ (loại trừ chat người chơi có <...> hoặc ': ')
            if (!(raw.includes('<') && raw.includes('>')) && !raw.includes(': ') && isMaintenanceMessage(raw)) {
                this.pauseForMaintenance(raw)
                return
            }

            // 1. Server yêu cầu đăng nhập
            if (
                lower.includes('đăng nhập bằng lệnh') ||
                lower.includes('dang nhap bang lenh') ||
                lower.includes('/dn')
            ) {
                this.sendLogin('Server yêu cầu đăng nhập', 500)
                return
            }

            // 2. Phiên đăng nhập kết nối trở lại (chờ 2.5s xem server có tự xác nhận thành công trước không)
            if (
                lower.includes('phiên đăng nhập đã được kết nối trở lại') ||
                lower.includes('phien dang nhap da duoc ket noi tro lai')
            ) {
                this.sendLogin('Phiên kết nối lại', 2500)
                return
            }

            // 3. Chưa hoàn thành xác thực tài khoản
            if (
                lower.includes('hoàn thành xác thực tài khoản') ||
                lower.includes('hoan thanh xac thuc tai khoan')
            ) {
                this.sendLogin('Chưa hoàn tất xác thực tài khoản', 1000)
                return
            }

            // 4. Đăng nhập thành công hoặc đã đăng nhập sẵn -> hủy timer /login thừa
            if (
                lower.includes('đăng nhập thành công') ||
                lower.includes('dang nhap thanh cong') ||
                lower.includes('bạn đã đăng nhập') ||
                lower.includes('ban da dang nhap')
            ) {
                if (this.loginPendingTimer) {
                    clearTimeout(this.loginPendingTimer)
                    this.loginPendingTimer = null
                }
                this.loggedIn = true
                this.inKingSMP = false
                this.requestMenu('Đăng nhập thành công', 3000)
                return
            }

            // 4b. Server báo chờ mở menu -> reset cooldown để tự thử lại ngay sau 3s
            if (lower.includes('vui lòng chờ') && lower.includes('menu')) {
                this.lastMenuSentTime = 0
                if (this.menuPendingTimer) {
                    clearTimeout(this.menuPendingTimer)
                    this.menuPendingTimer = null
                }
                this.requestMenu('Thử mở lại menu', 3000)
                return
            }

            // 5. Nhận biết đã vào KingSMP (qua /bal, đơn hàng, crate, donate, rtp...)
            if (isKingSMPMessage(cleanLower)) {
                this.markEnteredKingSMP()
                return
            }

            // 6. Phát hiện tin nhắn từ Sảnh (Lobby) - CHỈ KHI CHƯA VÀO KINGSMP VÀ KHÔNG PHẢI ĐANG CHUYỂN CỤM
            if (!this.inKingSMP && (Date.now() - this.lastMenuClickTime > 5000) && isLobbyMessage(cleanLower)) {
                this.requestMenu('Phát hiện thông báo Sảnh', 3000)
                return
            }

            // 7. Kiểm tra nếu server chuyển ngược về Sảnh (bảo trì / restart cụm SMP)
            if (
                lower.includes('chuyển về sảnh') ||
                lower.includes('chuyen ve sanh') ||
                lower.includes('mất kết nối tới cụm') ||
                lower.includes('mat ket noi toi cum') ||
                lower.includes('server đang khởi động lại') ||
                lower.includes('server dang khoi dong lai')
            ) {
                this.inKingSMP = false
                this.setPhysicsEnabled(true)
                this.rejectPendingQuery('Bot bị chuyển về Sảnh khi đang xử lý yêu cầu.')
                this.requestMenu('Bị chuyển về Sảnh', 3000)
                return
            }
        })

        bot.on('windowOpen', (window) => {
            const titleText = getText(window.title)

            if (titleText.toUpperCase().includes('MENU')) {
                setTimeout(() => {
                    if (!this.bot) return
                    this.lastMenuSentTime = Date.now()
                    this.lastMenuClickTime = Date.now()

                    this.bot.clickWindow(24, 0, 0)
                        .then(() => {
                            this.markEnteredKingSMP()

                            // Tự động gửi /bal sau 2.5s để cập nhật số dư và xác thực trạng thái
                            setTimeout(() => {
                                if (this.bot && this.inKingSMP) {
                                    this.bot.chat('/bal')
                                }
                            }, 2500)
                        })
                        .catch(err => this.log(`[CLICK ERROR] ${err.message}`, RED))
                }, 1000)
            } else if (this.pendingQuery) {
                this.pendingQuery.onWindow(window)
            } else {
                this.log(`[GUI] ${titleText}`)
                showWindowItems(window, this.color, this.username)
            }
        })

        bot.on('kicked', (reason) => {
            this.rejectPendingQuery('Bot bị kick khỏi server.')
            this.clearTimers()
            const plainReason = cleanMinecraftText(getText(reason)).replace(/\s*\n\s*/g, ' | ')
            const lowerReason = plainReason.toLowerCase()
            const normReason = normalizeSmallCaps(plainReason)

            // 0. Server đang bảo trì / khởi động lại hàng ngày -> Tự động out và nghỉ 30 phút
            if (isMaintenanceMessage(plainReason)) {
                this.pauseForMaintenance(plainReason)
                return
            }

            // 1. Server yêu cầu xác minh client ban đầu (Anti-Bot Verification) -> âm thầm reconnect vào lại
            if (normReason.includes('xac minh thanh cong')) {
                this.isVerifyReconnect = true
                this.scheduleReconnect(3000)
                return
            }

            // 2. Server báo chống spam / vui lòng chờ X giây (vd: 21s, 600s) -> chờ đúng số giây + 3s
            const waitSecMatch = normReason.match(/vui long cho\s+(\d+)\s*giay/)
            if (normReason.includes('khong spam') || waitSecMatch) {
                const waitSec = waitSecMatch ? parseInt(waitSecMatch[1], 10) : 15
                const delayMs = Math.max(10000, (waitSec + 3) * 1000)
                this.log(`[CHỐNG SPAM] Server yêu cầu chờ ${waitSec}s -> Đợi ${Math.round(delayMs / 1000)}s rồi vào lại...`, YELLOW)
                if (waitSec >= 60) {
                    sendDiscordAlert('⏳ Chờ Vào Lại Server', `**[${this.username}]** bị yêu cầu chờ **${waitSec} giây**.\nBot sẽ tự đợi ${Math.round(delayMs / 1000)}s rồi kết nối lại.`, 0xFFA502)
                }
                this.scheduleReconnect(delayMs, true)
                return
            }

            // 3. Bị tạm thời chặn 10 phút do hệ thống chống bot
            if (normReason.includes('tam thoi bi chan') || normReason.includes('10 phut')) {
                this.log(`[CẢNH BÁO] IP tạm thời bị hệ thống chống bot chặn 10 phút! Đang chờ tự động vào lại...`, RED)
                sendDiscordAlert('⛔ IP Bị Chặn 10 Phút', `Hệ thống chống bot KingMC tạm thời chặn IP 10 phút.\nBot sẽ tự động tạm dừng 10 phút để hết hạn phạt.`, 0xFF4757)
                this.scheduleReconnect(610000)
                return
            }

            // 4. Hệ thống chống bot không xác nhận được client
            if (normReason.includes('khong xac nhan duoc client')) {
                this.scheduleReconnect(IS_RENDER_ENV ? 12000 : 6000)
                return
            }

            this.log(`[KICK] ${plainReason}`, RED)
            try {
                sendDiscordAlert('⚠️ Bot Bị Kick', `**[${this.username}]** bị kick khỏi server:\n\`\`\`${plainReason}\`\`\``, 0xFF4757)
            } catch (_) {}
        })

        bot.on('error', (err) => {
            if (this.isVerifyReconnect && err.message && err.message.includes('ECONNRESET')) {
                return
            }
            this.consecutiveErrors = (this.consecutiveErrors || 0) + 1
            if (err.message && err.message.includes('ECONNRESET')) {
                if (this.consecutiveErrors >= 2) {
                    this.log(`[NETWORK] Server ngắt kết nối (read ECONNRESET) [Lần ${this.consecutiveErrors}]`, RED)
                }
            } else if (err.message && err.message.includes('Parse error')) {
                if (this.bot && this.bot._client) {
                    this.bot._client.end()
                }
            } else {
                this.log(`[ERROR] ${err.message}`, RED)
            }
        })

        bot.on('end', () => {
            const silentVerify = this.isVerifyReconnect
            this.rejectPendingQuery('Bot mất kết nối khỏi server.')
            this.clearTimers()
            if (!silentVerify && !this.stoppedManually && !this.reconnecting) {
                sendDiscordAlert('🔄 Bot Mất Kết Nối', `**[${this.username}]** đã ngắt kết nối. Đang tự động reconnect...`, 0xFFA502)
            }
            this.scheduleReconnect()
        })
    }
}


// ========================================
// BỘ QUẢN LÝ TOÀN CỤC & TƯƠNG TÁC DÒNG LỆNH
// ========================================

const activeBots = new Map() // ID (1,2,3,4) -> BotInstance
let focusedBotId = null // null: gửi cho all, hoặc id cụ thể (1, 2...)
let commandLineActive = false

function findBot(target) {
    if (!target) return null
    const num = parseInt(target)
    if (!isNaN(num) && num >= 1 && num <= accounts.length) {
        let instance = activeBots.get(num)
        if (!instance) {
            const acc = accounts[num - 1]
            const color = COLORS[(num - 1) % COLORS.length]
            instance = new BotInstance(num, acc, color)
            activeBots.set(num, instance)
        }
        return instance
    }
    const tLower = target.toLowerCase()
    for (const bot of activeBots.values()) {
        if (bot.username.toLowerCase() === tLower) {
            return bot
        }
    }
    const accIdx = accounts.findIndex(a => a.username.toLowerCase() === tLower)
    if (accIdx !== -1) {
        const id = accIdx + 1
        let instance = activeBots.get(id)
        if (!instance) {
            const acc = accounts[accIdx]
            const color = COLORS[accIdx % COLORS.length]
            instance = new BotInstance(id, acc, color)
            activeBots.set(id, instance)
        }
        return instance
    }
    return null
}

function updatePrompt() {
    if (!commandLineActive || !rl) return
    if (focusedBotId) {
        const bot = activeBots.get(focusedBotId)
        if (bot) {
            rl.setPrompt(`${bot.color}[${bot.username}]${RESET} > `)
            rl.prompt(true)
            return
        }
    }
    rl.setPrompt(`${BOLD}[ALL]${RESET} > `)
    rl.prompt(true)
}

function showHelp() {
    if (commandLineActive) clearCurrentLine()
    console.log('')
    console.log('========================================')
    console.log(`         ${BOLD}HƯỚNG DẪN LỆNH ĐIỀU KHIỂN${RESET}`)
    console.log('========================================')
    console.log(`${YELLOW}1. Quản lý trạng thái & Bảng thông tin (Scoreboard):${RESET}`)
    console.log(`   ${CYAN}status${RESET} / ${CYAN}list${RESET}         : Xem danh sách trạng thái tổng quan các bot`)
    console.log(`   ${CYAN}status <id/tên>${RESET}     : Xem bảng thông tin (Scoreboard) của bot (ví dụ: status 1 hoặc status 2)`)
    console.log(`   ${CYAN}start <id/tên>${RESET}      : Bật lại 1 bot (ví dụ: start 1 hoặc start duykhang286)`)
    console.log(`   ${CYAN}stop <id/tên>${RESET}       : Tắt 1 bot (ví dụ: stop 1 hoặc stop duykhang286)`)
    console.log(`   ${CYAN}proxy${RESET}               : Xem hoặc cài đặt Proxy SOCKS5 (ví dụ: proxy 1.2.3.4:1080:user:pass | proxy off)`)
    console.log(`   ${CYAN}version${RESET}             : Xem hoặc đổi phiên bản Minecraft (ví dụ: version 1.20.1)`)
    console.log('')
    console.log(`${YELLOW}2. Gửi lệnh & chat:${RESET}`)
    console.log(`   ${CYAN}<id> <lệnh>${RESET}         : Gửi riêng cho 1 bot (ví dụ: 1 /ah hoặc 4 /order elytra)`)
    console.log(`   ${CYAN}<id> click <slot>${RESET}   : Click slot trên bot cụ thể (ví dụ: 1 click 24)`)
    console.log(`   ${CYAN}<id> close${RESET}          : Đóng GUI trên bot cụ thể (ví dụ: 1 close)`)
    console.log(`   ${CYAN}<id> inv${RESET}            : Xem túi đồ bot (ví dụ: 1 inv)`)
    console.log(`   ${CYAN}focus <id>${RESET}          : Chuyển sang điều khiển riêng 1 bot (ví dụ: focus 1)`)
    console.log(`   ${CYAN}focus all${RESET}           : Chuyển về chế độ điều khiển tất cả bot`)
    console.log(`   ${CYAN}<lệnh>${RESET}              : Gửi cho bot đang focus (hoặc tất cả nếu focus all)`)
    console.log('========================================')
    console.log('')
}

function showStatus() {
    if (commandLineActive) clearCurrentLine()
    console.log('')
    console.log('========================================')
    console.log(`           ${BOLD}TRẠNG THÁI CÁC BOT${RESET}`)
    console.log('========================================')
    accounts.forEach((acc, index) => {
        const id = index + 1
        const color = COLORS[index % COLORS.length]
        const instance = activeBots.get(id)
        let statusText = `${RED}Offline (Chưa chạy)${RESET}`
        if (instance) {
            const isReallyInSMP = instance.inKingSMP || Boolean(
                (instance.bot?.scoreboards?.['kmsb']) ||
                (instance.bot?.scoreboard?.sidebar && getText(instance.bot.scoreboard.sidebar.title).toLowerCase().includes('kingsmp'))
            )
            if (isReallyInSMP && !instance.inKingSMP) {
                instance.inKingSMP = true
            }

            if (instance.stoppedManually) {
                statusText = `${RED}Đã dừng (Manual Stop)${RESET}`
            } else if (instance.maintenanceUntil > Date.now() && !instance.bot) {
                const minsLeft = Math.max(1, Math.ceil((instance.maintenanceUntil - Date.now()) / 60000))
                statusText = `${YELLOW}Nghỉ bảo trì (vào lại sau ~${minsLeft}p)${RESET}`
            } else if (instance.inKingSMP) {
                statusText = `${GREEN}Online (KingSMP)${RESET}`
            } else if (instance.loggedIn) {
                statusText = `${YELLOW}Online (Sảnh)${RESET}`
            } else if (instance.reconnecting) {
                statusText = `${YELLOW}Đang reconnect...${RESET}`
            } else if (instance.bot) {
                statusText = `${CYAN}Đang kết nối...${RESET}`
            }

            if (instance.proxy && !instance.proxy.disabled) {
                statusText += ` ${DIM}[Proxy: ${instance.proxy.host}:${instance.proxy.port}]${RESET}`
            }
        }
        console.log(`${color}[${id}] ${acc.username.padEnd(16)}${RESET}: ${statusText}`)
    })
    console.log('========================================')
    console.log(`${DIM}Mẹo: Gõ "status 1" hoặc "status 2" để xem Bảng thông tin (Scoreboard).${RESET}`)
    console.log('========================================')
    console.log('')
}

function extractScoreboardData(items) {
    let money = ''
    let shards = ''
    let kill = ''
    let die = ''
    let keyTime = ''
    let onlineTime = ''
    let team = ''
    let ping = ''

    for (const item of items) {
        let raw = ''
        try {
            if (item.displayNameOverride) {
                raw = getText(item.displayNameOverride)
            } else if (item.displayName) {
                if (typeof item.displayName.toString === 'function') {
                    raw = item.displayName.toString()
                } else {
                    raw = String(item.displayName)
                }
            }
        } catch (_) { }
        if (!raw) raw = item.name || ''

        const cleaned = stripAnsi(raw).replace(/[\uE000-\uF8FF\uFFFD]/g, '').trim()
        if (!cleaned) continue

        // 1. Money: chứa $
        if (cleaned.includes('$')) {
            money = cleaned
            continue
        }

        // 2. Shards: chứa ★
        if (cleaned.includes('★')) {
            shards = cleaned.replace(/★/g, '').trim()
            continue
        }

        // 3. Die: chứa ☠
        if (cleaned.includes('☠')) {
            die = cleaned.replace(/☠/g, '').trim()
            continue
        }

        // 4. Online: chứa ⌚ hoặc định dạng ngày/giờ (vd: "17d 7h")
        if (cleaned.includes('⌚') || /[0-9]+d\s+[0-9]+h/i.test(cleaned)) {
            onlineTime = cleaned.replace(/⌚/g, '').trim()
            continue
        }

        // 5. Key: thời gian phút/giây (vd: "6m 57s")
        if (/^[0-9]+m\s+[0-9]+s$/i.test(cleaned) || /^[0-9]+h\s+[0-9]+m/i.test(cleaned)) {
            keyTime = cleaned
            continue
        }

        // 6. Ping: chứa kingmc.vn hoặc ᴋɪɴɢᴍᴄ.ᴠɴ
        if (normalizeSmallCaps(cleaned).includes('kingmc.vn')) {
            const match = cleaned.match(/([0-9]+)$/)
            ping = match ? match[1] : cleaned
            continue
        }

        // 7. Kill: số nguyên đứng riêng
        if (/^[0-9]+$/.test(cleaned) && kill === '') {
            kill = cleaned
            continue
        }

        // 8. Team: tên chữ/số
        if (/^[a-zA-Z0-9_]{2,20}$/.test(cleaned) && team === '') {
            team = cleaned
            continue
        }
    }

    return { money, shards, kill, die, keyTime, onlineTime, team, ping }
}

function showScoreboard(botInstance) {
    if (!botInstance) return
    if (commandLineActive) clearCurrentLine()

    if (!botInstance.bot) {
        console.log('')
        console.log('========================================')
        console.log(`  ${botInstance.color}[${botInstance.username}]${RESET}`)
        console.log('========================================')
        console.log(`  ${RED}Bot đang Offline, không có dữ liệu scoreboard.${RESET}`)
        console.log(`  Gõ "${CYAN}start ${botInstance.id}${RESET}" để khởi động bot.`)
        console.log('========================================')
        console.log('')
        return
    }

    let sb = null
    if (botInstance.bot.scoreboard && botInstance.bot.scoreboard.sidebar && botInstance.bot.scoreboard.sidebar.items && botInstance.bot.scoreboard.sidebar.items.length > 0) {
        sb = botInstance.bot.scoreboard.sidebar
    }
    if (!sb && botInstance.bot.scoreboards) {
        if (botInstance.bot.scoreboards['kmsb'] && botInstance.bot.scoreboards['kmsb'].items && botInstance.bot.scoreboards['kmsb'].items.length > 0) {
            sb = botInstance.bot.scoreboards['kmsb']
        } else if (botInstance.bot.scoreboards['TAB-Scoreboard'] && botInstance.bot.scoreboards['TAB-Scoreboard'].items && botInstance.bot.scoreboards['TAB-Scoreboard'].items.length > 0) {
            sb = botInstance.bot.scoreboards['TAB-Scoreboard']
        } else {
            const allSb = Object.values(botInstance.bot.scoreboards)
            sb = allSb.find(s => s.items && s.items.length > 0) || botInstance.bot.scoreboard?.sidebar || allSb[0]
        }
    }

    if (!sb || !sb.items || sb.items.length === 0) {
        const allNames = botInstance.bot.scoreboards ? Object.keys(botInstance.bot.scoreboards).join(', ') : ''
        console.log('')
        console.log('========================================')
        console.log(`  ${botInstance.color}[${botInstance.username}]${RESET}`)
        console.log('========================================')
        console.log(`  ${YELLOW}(Chưa nhận được dữ liệu bảng thông tin từ server)${RESET}`)
        if (allNames) {
            console.log(`  ${DIM}Objectives hiện có: [${allNames}]${RESET}`)
        }
        console.log(`  ${DIM}Trạng thái: ${botInstance.inKingSMP ? 'Đã vào KingSMP' : 'Chưa vào cụm SMP'}${RESET}`)
        console.log('========================================')
        console.log('')
        return
    }

    const data = extractScoreboardData(sb.items)

    console.log('')
    console.log('========================================')
    console.log(`  ${botInstance.color}[${botInstance.username}]${RESET}`)
    console.log(`Money:  ${GREEN}${data.money || '$ 0'}${RESET}`)
    console.log(`Shards: ${YELLOW}${data.shards || '0'}${RESET}`)
    console.log(`Kill ${RED}${data.kill || '0'}${RESET}. Die ${RED}${data.die || '0'}${RESET}`)
    console.log(`Key ${BLUE}${data.keyTime || '0m 0s'}${RESET}`)
    console.log(` Online ${CYAN}${data.onlineTime || '0h'}${RESET}`)
    console.log(`Team ${MAGENTA}${data.team || 'None'}${RESET}`)
    console.log(`Ping ${YELLOW}${data.ping || '0'}${RESET}`)
    console.log('========================================')
    console.log('')
}

function startSingleBot(target) {
    const bot = findBot(target)
    if (!bot) {
        console.log(`${RED}[ERROR] Không tìm thấy account "${target}". Gõ "status" để xem danh sách.${RESET}`)
        return
    }

    if (bot.bot && !bot.stoppedManually) {
        bot.log('[INFO] Bot này đã đang chạy!', YELLOW)
        return
    }

    if (currentProxy) {
        bot.proxy = { ...currentProxy }
    }

    bot.start()
}

function executeCommandOnBot(botInstance, cmd) {
    const trimmed = cmd.trim()
    const lower = trimmed.toLowerCase()

    if (lower === 'sb' || lower === 'scoreboard' || lower === 'status') {
        showScoreboard(botInstance)
        return
    }

    if (!botInstance.bot) {
        botInstance.log('[ERROR] Bot đang offline, không thể gửi lệnh!', RED)
        return
    }

    if (lower.startsWith('click ')) {
        const parts = lower.split(' ')
        const slot = parseInt(parts[1])
        if (isNaN(slot)) {
            botInstance.log('[ERROR] Slot không hợp lệ!', RED)
            return
        }
        botInstance.click(slot)
        return
    }

    if (lower === 'close') {
        botInstance.close()
        return
    }

    if (lower === 'inv' || lower === 'inventory') {
        const items = botInstance.bot.inventory ? botInstance.bot.inventory.items() : []
        console.log(`\n--- TÚI ĐỒ CỦA [${botInstance.username}] (${items.length} items) ---`)
        if (items.length === 0) {
            console.log('Túi đồ trống!')
        } else {
            for (const it of items) {
                console.log(`Slot ${it.slot}: x${it.count} ${it.displayName || it.name} (${it.name})`)
            }
        }
        console.log('-------------------------------------------\n')
        return
    }

    if (!botInstance.isChatReady()) {
        botInstance.log('[ERROR] Bot chưa vào game (đang kết nối hoặc offline), không thể gửi lệnh!', RED)
        return
    }

    botInstance.chat(trimmed)
}

function setupCommandLine() {
    if (!rl) {
        commandLineActive = false
        return
    }
    commandLineActive = true
    rl.removeAllListeners('line')

    rl.on('line', (input) => {
        const trimmed = input.trim()
        if (!trimmed) {
            updatePrompt()
            return
        }

        const lower = trimmed.toLowerCase()

        // Lệnh Help
        if (lower === 'help' || lower === '?') {
            showHelp()
            updatePrompt()
            return
        }

        // Lệnh Status / List tổng quan
        if (lower === 'status' || lower === 'list') {
            showStatus()
            updatePrompt()
            return
        }

        // Lệnh Status <id/name> hoặc Scoreboard <id/name>
        if (lower.startsWith('status ') || lower.startsWith('list ') || lower.startsWith('sb ') || lower.startsWith('scoreboard ')) {
            const target = lower.split(/\s+/)[1]
            const targetBot = findBot(target)
            if (targetBot) {
                showScoreboard(targetBot)
            } else {
                console.log(`${RED}[ERROR] Không tìm thấy bot "${target}". Gõ "status" để xem danh sách.${RESET}`)
            }
            updatePrompt()
            return
        }

        // Lệnh SB / Scoreboard (không có tham số)
        if (lower === 'sb' || lower === 'scoreboard') {
            if (focusedBotId) {
                const targetBot = activeBots.get(focusedBotId)
                if (targetBot) {
                    showScoreboard(targetBot)
                    updatePrompt()
                    return
                }
            }
            showStatus()
            console.log(`${YELLOW}[HƯỚNG DẪN] Gõ "status 1" hoặc "status 2" để xem Bảng thông tin (Scoreboard) của từng bot.${RESET}\n`)
            updatePrompt()
            return
        }

        // Lệnh Stop <id/name>
        if (lower.startsWith('stop ') || lower.startsWith('quit ')) {
            const target = lower.split(/\s+/)[1]
            const bot = findBot(target)
            if (bot) {
                bot.stop()
            } else {
                console.log(`${RED}[ERROR] Không tìm thấy bot "${target}". Gõ "status" để xem danh sách.${RESET}`)
            }
            updatePrompt()
            return
        }

        // Lệnh Start <id/name>
        if (lower.startsWith('start ') || lower.startsWith('run ')) {
            const target = lower.split(/\s+/)[1]
            startSingleBot(target)
            updatePrompt()
            return
        }

        // Lệnh Proxy
        if (lower === 'proxy' || lower.startsWith('proxy ')) {
            const arg = trimmed.slice(5).trim()
            if (!arg) {
                if (currentProxy) {
                    const authStr = currentProxy.userId ? ` (User: ${currentProxy.userId})` : ''
                    console.log(`${GREEN}[PROXY] Proxy SOCKS5 hiện tại: ${currentProxy.host}:${currentProxy.port}${authStr}${RESET}`)
                } else {
                    console.log(`${YELLOW}[PROXY] Hiện tại chưa sử dụng Proxy (kết nối trực tiếp IP máy).${RESET}`)
                }
                console.log(`${DIM}Cách đổi: proxy <IP:Port:User:Pass> | Tắt: proxy off${RESET}`)
            } else {
                const parsed = parseProxyString(arg)
                if (parsed && parsed.disabled) {
                    currentProxy = null
                    console.log(`${YELLOW}[PROXY] Đã tắt Proxy SOCKS5. Các kết nối mới sẽ dùng IP máy.${RESET}`)
                } else if (parsed && parsed.host && parsed.port) {
                    currentProxy = parsed
                    const authStr = parsed.userId ? ` (User: ${parsed.userId})` : ''
                    console.log(`${GREEN}[PROXY] Đã cập nhật Proxy SOCKS5: ${parsed.host}:${parsed.port}${authStr}${RESET}`)
                    console.log(`${DIM}Proxy sẽ được áp dụng cho các lần kết nối mới / reconnect.${RESET}`)
                } else {
                    console.log(`${RED}[ERROR] Định dạng proxy không hợp lệ! Vui lòng nhập: proxy IP:Port:User:Pass hoặc proxy IP:Port${RESET}`)
                }
            }
            updatePrompt()
            return
        }

        // Lệnh Version: version <ver>
        if (lower === 'version' || lower.startsWith('version ') || lower === 'ver' || lower.startsWith('ver ')) {
            const arg = trimmed.split(/\s+/)[1]
            if (!arg) {
                console.log(`${GREEN}[VERSION] Phiên bản Minecraft hiện tại: ${BOLD}${MC_VERSION}${RESET}`)
                console.log(`${DIM}Phiên bản tối ưu nhất cho KingMC hiện tại là 1.20.1 (vượt Anti-Bot chuẩn nhất).${RESET}`)
                console.log(`${DIM}Cách đổi: version 1.20.1 (sẽ áp dụng cho các lần kết nối mới/reconnect)${RESET}`)
            } else {
                MC_VERSION = arg.trim()
                console.log(`${GREEN}[VERSION] Đã đổi phiên bản Minecraft sang: ${BOLD}${MC_VERSION}${RESET}`)
                console.log(`${YELLOW}[LƯU Ý] Phiên bản mới sẽ áp dụng khi bot kết nối lại hoặc khởi động mới.${RESET}`)
            }
            updatePrompt()
            return
        }

        // Lệnh Focus / Select <id/name/all>
        if (lower.startsWith('focus ') || lower.startsWith('select ')) {
            const target = lower.split(/\s+/)[1]
            if (target === 'all' || target === '0') {
                focusedBotId = null
                console.log(`${CYAN}[SYSTEM] Đã chuyển sang chế độ điều khiển: TẤT CẢ BOT (ALL)${RESET}`)
            } else {
                const targetBot = findBot(target)
                if (targetBot) {
                    focusedBotId = targetBot.id
                    console.log(`${CYAN}[SYSTEM] Đang focus điều khiển: ${targetBot.color}[${targetBot.username}]${RESET}`)
                } else {
                    console.log(`${RED}[ERROR] Không tìm thấy bot "${target}". Gõ "status" để xem.${RESET}`)
                }
            }
            updatePrompt()
            return
        }

        // Kiểm tra tiền tố gửi riêng: ví dụ "1 /ah" hoặc "1: /ah" hoặc "duykhang286 /order elytra"
        const prefixMatch = trimmed.match(/^([a-zA-Z0-9_]+)[:\s]+(.*)$/)
        if (prefixMatch) {
            const potentialTarget = prefixMatch[1]
            const subCmd = prefixMatch[2]
            const targetBot = findBot(potentialTarget)
            if (targetBot) {
                executeCommandOnBot(targetBot, subCmd)
                updatePrompt()
                return
            }
        }

        // Lệnh không có tiền tố: gửi cho bot đang focus hoặc tất cả bot
        if (focusedBotId) {
            const bot = activeBots.get(focusedBotId)
            if (bot) {
                executeCommandOnBot(bot, trimmed)
            } else {
                console.log(`${RED}[ERROR] Bot đang focus không khả dụng! Gõ "focus all" để reset.${RESET}`)
            }
        } else {
            // Gửi cho tất cả bot đang online
            let sentCount = 0
            for (const bot of activeBots.values()) {
                if (bot.bot && !bot.stoppedManually) {
                    if (bot.isChatReady()) {
                        executeCommandOnBot(bot, trimmed)
                        sentCount++
                    } else {
                        bot.log('[WARN] Bot đang kết nối hoặc chưa vào sảnh, tạm bỏ qua lệnh.', YELLOW)
                    }
                }
            }
            if (sentCount === 0) {
                console.log(`${YELLOW}[INFO] Chưa có bot nào sẵn sàng trong server để nhận lệnh. Vui lòng đợi bot kết nối xong.${RESET}`)
            }
        }

        updatePrompt()
    })

    updatePrompt()
}


// ========================================
// MENU CHỌN VÀ KHỞI ĐỘNG TÀI KHOẢN
// ========================================

function printAccountsMenu() {
    console.log('')
    console.log('========================================')
    console.log(`         ${BOLD}DANH SÁCH ACCOUNT${RESET}`)
    console.log('========================================')
    accounts.forEach((acc, index) => {
        const id = index + 1
        const color = COLORS[index % COLORS.length]
        console.log(`${color}${id}. ${acc.username}${RESET}`)
    })

    const proxyStatus = currentProxy
        ? `${GREEN}[${currentProxy.host}:${currentProxy.port}${currentProxy.userId ? ` | User: ${currentProxy.userId}` : ''}]${RESET}`
        : `${DIM}[Chưa dùng]${RESET}`

    console.log(`${CYAN}${accounts.length + 1}. Cài đặt Proxy SOCKS5 ${proxyStatus}`)
    console.log(`${MAGENTA}${accounts.length + 2}. Nhập account mới thủ công${RESET}`)
    console.log('========================================')
    console.log('')
}

function parseAccountIndices(input, accountList = accounts) {
    if (!input || String(input).trim().toLowerCase() === 'all') {
        return accountList.map((_, i) => i)
    }
    const str = String(input).trim()
    const indices = []

    if (/[\s,;.-]/.test(str)) {
        const parts = str.split(/[\s,;.-]+/).filter(Boolean)
        for (const p of parts) {
            const n = parseInt(p, 10)
            if (!isNaN(n) && n >= 1 && n <= accountList.length) {
                if (!indices.includes(n - 1)) indices.push(n - 1)
            } else {
                const idx = accountList.findIndex(a => a.username.toLowerCase() === p.toLowerCase())
                if (idx !== -1 && !indices.includes(idx)) indices.push(idx)
            }
        }
        return indices
    }

    if (/^\d+$/.test(str)) {
        if (str.length > 1) {
            for (const ch of str.split('')) {
                const n = parseInt(ch, 10)
                if (n >= 1 && n <= accountList.length && !indices.includes(n - 1)) {
                    indices.push(n - 1)
                }
            }
            if (indices.length > 0) return indices
        }
        const n = parseInt(str, 10)
        if (n >= 1 && n <= accountList.length) return [n - 1]
    }

    const idx = accountList.findIndex(a => a.username.toLowerCase() === str.toLowerCase())
    if (idx !== -1) return [idx]

    return []
}

async function startSelectedAccounts(selectedIndices) {
    console.log('')
    console.log(`${GREEN}[SYSTEM] Đang kết nối ${selectedIndices.length} acc${currentProxy ? ` qua Proxy ${currentProxy.host}:${currentProxy.port}` : ''}... (Gõ "help" xem lệnh)${RESET}\n`)

    for (let i = 0; i < selectedIndices.length; i++) {
        const accIndex = selectedIndices[i]
        const acc = accounts[accIndex]
        const id = accIndex + 1
        const color = COLORS[accIndex % COLORS.length]

        let botInstance = activeBots.get(id)
        if (!botInstance) {
            botInstance = new BotInstance(id, acc, color)
            activeBots.set(id, botInstance)
        } else {
            botInstance.proxy = currentProxy ? { ...currentProxy } : null
        }

        botInstance.start()

        // Giãn cách kết nối giữa các acc (Render ping xa nên giãn 12s tránh dính chặn 10 phút anti-bot)
        if (i < selectedIndices.length - 1) {
            await new Promise(r => setTimeout(r, IS_RENDER_ENV ? 12000 : 3000))
        }
    }
}

async function selectAccount() {
    if (!rl) return
    printAccountsMenu()

    const proxyMenuChoice = String(accounts.length + 1)
    const manualMenuChoice = String(accounts.length + 2)

    rl.question('Chọn: ', async (choice) => {
        choice = choice.trim()

        if (!choice) {
            selectAccount()
            return
        }

        // Cài đặt Proxy SOCKS5
        if (choice === proxyMenuChoice || choice.toLowerCase() === 'proxy' || choice.toLowerCase() === 'p') {
            rl.question('Nhập Proxy (IP:Port:User:Pass hoặc IP:Port, gõ "xoa" để tắt): ', (proxyInput) => {
                const parsed = parseProxyString(proxyInput)
                if (parsed && parsed.disabled) {
                    currentProxy = null
                    console.log(`\n${YELLOW}[PROXY] Đã tắt Proxy. Các bot sẽ kết nối trực tiếp IP máy.${RESET}\n`)
                } else if (parsed && parsed.host && parsed.port) {
                    currentProxy = parsed
                    const authStr = parsed.userId ? ` (User: ${parsed.userId})` : ''
                    console.log(`\n${GREEN}[PROXY] Đã lưu cấu hình Proxy SOCKS5: ${parsed.host}:${parsed.port}${authStr}${RESET}\n`)
                } else if (!proxyInput.trim()) {
                    console.log(`\n${DIM}[PROXY] Giữ nguyên cài đặt proxy.${RESET}\n`)
                } else {
                    console.log(`\n${RED}[ERROR] Định dạng không hợp lệ! Vui lòng nhập dạng IP:Port:User:Pass hoặc IP:Port.${RESET}\n`)
                }
                selectAccount()
            })
            return
        }

        // Nhập account mới thủ công
        if (choice === manualMenuChoice) {
            rl.question('Nhập Ingame Name: ', (newUsername) => {
                rl.question('Nhập password /login: ', (newPassword) => {
                    newUsername = newUsername.trim()
                    newPassword = newPassword.trim()

                    if (!newUsername || !newPassword) {
                        console.log(`${RED}[ERROR] Không được để trống.${RESET}`)
                        selectAccount()
                        return
                    }

                    const newAcc = { username: newUsername, password: newPassword }
                    accounts.push(newAcc)
                    const newId = accounts.length
                    const color = COLORS[(newId - 1) % COLORS.length]
                    const instance = new BotInstance(newId, newAcc, color)
                    activeBots.set(newId, instance)
                    instance.start()
                    setupCommandLine()
                })
            })
            return
        }

        if (choice.toLowerCase() === 'all' && accounts.length > 3 && !currentProxy) {
            console.log(`${YELLOW}[THÔNG BÁO] Server KingMC chỉ cho phép tối đa 3 acc / 1 IP. Vui lòng chọn tối đa 3 acc.${RESET}`)
            selectAccount()
            return
        }

        const selectedIndices = parseAccountIndices(choice, accounts)

        if (selectedIndices.length === 0) {
            console.log(`${RED}[ERROR] Lựa chọn không hợp lệ, vui lòng chọn lại.${RESET}`)
            selectAccount()
            return
        }

        if (selectedIndices.length > 3) {
            if (!currentProxy) {
                console.log(`${RED}[CẢNH BÁO] Server KingMC chỉ cho phép tối đa 3 acc / 1 IP! Bạn đã chọn ${selectedIndices.length} acc.${RESET}`)
                console.log(`${YELLOW}Vui lòng chỉ chọn tối đa 3 acc. Hoặc chọn ${proxyMenuChoice} để cài đặt Proxy SOCKS5.${RESET}`)
                selectAccount()
                return
            } else {
                console.log(`${YELLOW}[LƯU Ý] Bạn đang chạy ${selectedIndices.length} acc. Nếu Proxy là IP tĩnh, server có thể giới hạn tối đa 3 acc / 1 IP của Proxy.${RESET}`)
            }
        }

        await startSelectedAccounts(selectedIndices)
        setupCommandLine()
    })
}

// ========================================
// TÍCH HỢP DISCORD BOT (EMBEDDED CHO 1 FILE DUY NHẤT)
// ========================================

const DISCORD_CONFIG_FILE = path.join(__dirname, activeProfile.configFile)

const DEFAULT_DISCORD_CONFIG = {
    token: 'THAY_TOKEN_BOT_DISCORD_RENDER_VAO_DAY',
    prefix: '!',
    alertChannelId: '',
    streamLogs: true
}

function loadDiscordConfig() {
    let cfg = { ...DEFAULT_DISCORD_CONFIG }
    try {
        if (fs.existsSync(DISCORD_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(DISCORD_CONFIG_FILE, 'utf8'))
            cfg = { ...cfg, ...data }
        }
    } catch (_) {}

    // Ưu tiên biến môi trường (Environment Variables trên Render) để không mất cấu hình khi Render redeploy/restart
    if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN.trim()) {
        cfg.token = process.env.DISCORD_TOKEN.trim()
    }
    if (process.env.DISCORD_CHANNEL_ID && process.env.DISCORD_CHANNEL_ID.trim()) {
        cfg.alertChannelId = process.env.DISCORD_CHANNEL_ID.trim()
    }
    if (process.env.DISCORD_PREFIX && process.env.DISCORD_PREFIX.trim()) {
        cfg.prefix = process.env.DISCORD_PREFIX.trim()
    }
    if (process.env.STREAM_LOGS !== undefined) {
        const raw = String(process.env.STREAM_LOGS).trim().toLowerCase()
        cfg.streamLogs = !['false', '0', 'off', 'no'].includes(raw)
    }
    return cfg
}

function saveDiscordConfig(cfg) {
    try {
        // Không ghi đè token nếu đang nạp từ biến môi trường DISCORD_TOKEN
        const toSave = process.env.DISCORD_TOKEN
            ? { ...cfg, token: DEFAULT_DISCORD_CONFIG.token }
            : cfg
        fs.writeFileSync(DISCORD_CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf8')
    } catch (err) {
        originalConsoleError('[DISCORD] Không thể lưu config:', err.message)
    }
}

let discordClient = null
let discordConfig = loadDiscordConfig()
let discordAppContext = null
let isStreamingEnabled = discordConfig.streamLogs !== false
let logBuffer = []
let flushTimer = null
let isForwarding = false

function forwardLogToDiscord(text) {
    if (isForwarding || !isStreamingEnabled) return
    if (!discordClient || !discordClient.isReady()) return
    const channelId = discordConfig.alertChannelId
    if (!channelId) return

    isForwarding = true
    try {
        const clean = stripAnsi(text)
        if (!clean) return

        const splitLines = clean.split('\n')
        for (const line of splitLines) {
            const trimmed = line.trimEnd()
            if (trimmed && !trimmed.startsWith('>') && trimmed !== '[ALL] >') {
                logBuffer.push(trimmed)
            }
        }

        if (logBuffer.length > 60) {
            logBuffer = logBuffer.slice(-60)
        }

        if (!flushTimer) {
            flushTimer = setTimeout(flushLogsToDiscord, 1000)
        }
    } finally {
        isForwarding = false
    }
}

// Tự động hook console.log & console.error để stream toàn bộ output CMD lên Discord
const originalConsoleLog = console.log
const originalConsoleError = console.error

console.log = function (...args) {
    originalConsoleLog.apply(console, args)
    if (!isStreamingEnabled) return
    try {
        const text = args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
        if (text.includes('[DISCORD]') || text.includes(activeProfile.configFile) || text.includes('discord_render') || text.includes('discord_config')) return
        forwardLogToDiscord(text)
    } catch (_) {}
}

console.error = function (...args) {
    originalConsoleError.apply(console, args)
    if (!isStreamingEnabled) return
    try {
        const text = args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' ')
        if (text.includes('[DISCORD]') || text.includes(activeProfile.configFile) || text.includes('discord_render') || text.includes('discord_config')) return
        forwardLogToDiscord(`[ERROR] ${text}`)
    } catch (_) {}
}

async function flushLogsToDiscord() {
    flushTimer = null
    if (logBuffer.length === 0) return
    if (!discordClient || !discordClient.isReady()) {
        logBuffer = []
        return
    }

    const channelId = discordConfig.alertChannelId
    if (!channelId) {
        logBuffer = []
        return
    }

    const channel = discordClient.channels.cache.get(channelId)
    if (!channel || !channel.isTextBased()) {
        logBuffer = []
        return
    }

    const lines = logBuffer.splice(0, logBuffer.length)
    const chunks = []
    let currentChunk = ''

    for (const line of lines) {
        if ((currentChunk + '\n' + line).length > 1850) {
            if (currentChunk) chunks.push(currentChunk)
            currentChunk = line
        } else {
            currentChunk = currentChunk ? (currentChunk + '\n' + line) : line
        }
    }
    if (currentChunk) chunks.push(currentChunk)

    for (const chunk of chunks) {
        try {
            await channel.send(`\`\`\`text\n${chunk}\n\`\`\``)
            await new Promise(r => setTimeout(r, 600))
        } catch (_) {}
    }
}

function sendDiscordAlert(title, description, color = 0xFFA502) {
    if (!discordClient || !discordClient.isReady()) return
    const channelId = discordConfig.alertChannelId
    if (!channelId) return

    try {
        const channel = discordClient.channels.cache.get(channelId)
        if (channel && channel.isTextBased()) {
            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .setTimestamp()
            channel.send({ embeds: [embed] }).catch(() => {})
        }
    } catch (_) {}
}

const paginationSessions = new Map()
const PAGINATION_TTL_MS = 5 * 60 * 1000

function chunkArray(array, size = 9) {
    if (!Array.isArray(array) || array.length === 0) return []
    const chunks = []
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size))
    }
    return chunks
}

function buildPaginationRow(sessionId, currentPage, totalPages, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`page_${sessionId}_prev`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || currentPage <= 1),
        new ButtonBuilder()
            .setCustomId(`page_${sessionId}_indicator`)
            .setLabel(`${currentPage}/${totalPages}`)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`page_${sessionId}_next`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled || currentPage >= totalPages)
    )
}

function buildMarketEmbed({ type, query, pages, pageIndex, totalCount, botUsername }) {
    const totalPages = pages.length
    const pageItems = pages[pageIndex - 1] || []
    const startIdx = (pageIndex - 1) * 9

    const isOrder = (type === 'order')
    const titlePrefix = isOrder ? '📦 Danh sách Order' : '🛒 Chợ Đấu Giá (AH)'
    const titleText = totalPages > 1
        ? `${titlePrefix}: **${query}** (Trang ${pageIndex}/${totalPages})`
        : `${titlePrefix}: **${query}**`

    const blocks = pageItems.map((entry, idx) => {
        const stt = startIdx + idx + 1
        const cleanDisplay = cleanMinecraftText(entry.displayName || '').trim()
        const normDisplay = normalizeSmallCaps(cleanDisplay)
        const isOrderTitle = /^(?:don\s*hang|order)/i.test(normDisplay) || normDisplay.includes('don hang')

        const itemTitle = (cleanDisplay && cleanDisplay !== 'Item' && cleanDisplay !== 'Vật phẩm' && !(isOrder && isOrderTitle))
            ? cleanDisplay
            : (entry.itemName && entry.itemName !== 'player_head' && entry.itemName !== 'skull'
                ? formatItemDisplayName(entry.itemName)
                : query)

        if (isOrder) {
            const progress = entry.delivered
                ? `Đã giao: \`${entry.delivered}\`${entry.remaining !== null ? ` (Còn: \`${entry.remaining}\`)` : ''}`
                : (entry.remaining !== null ? `Cần mua: \`${entry.remaining}\`` : `Số lượng: \`${entry.quantity || '1'}\``)
            return `**#${stt} ${itemTitle}** • Giá: **${entry.price || 'N/A'}**\n   └ Người mua: **${entry.buyer || 'Ẩn danh'}** • ${progress}`
        } else {
            const expPart = entry.expiration ? ` • Hết hạn: \`${entry.expiration}\`` : ''
            return `**#${stt} ${itemTitle}** • Giá: **${entry.price || 'N/A'}**\n   └ Người bán: **${entry.seller || 'Ẩn danh'}** • SL: \`${entry.quantity || '1'}\`${expPart}`
        }
    })

    let desc = blocks.join('\n')
    if (desc.length > 4096) desc = desc.slice(0, 4080) + '...'

    return new EmbedBuilder()
        .setTitle(titleText)
        .setColor(isOrder ? 0x5865F2 : 0x2ECC71)
        .setDescription(desc || 'Không có dữ liệu.')
        .setFooter({ text: `Bot: ${botUsername || 'KingMC'} • Tổng ${totalCount} kết quả • Hết hạn nút sau 5 phút` })
        .setTimestamp()
}

function createPaginationSession({ messageRef, authorId, type, query, pages, totalCount, botUsername }) {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const session = {
        id: sessionId,
        authorId,
        messageRef,
        type,
        query,
        pages,
        totalPages: pages.length,
        totalCount,
        botUsername,
        currentPage: 1,
        timer: null
    }

    const scheduleExpiry = () => setTimeout(async () => {
        try {
            const disabledRow = buildPaginationRow(sessionId, session.currentPage, session.totalPages, true)
            await session.messageRef.edit({ components: [disabledRow] }).catch(() => { })
        } catch (_) { }
        session.pages = null
        paginationSessions.delete(sessionId)
    }, PAGINATION_TTL_MS)

    session.timer = scheduleExpiry()
    session.resetTimer = () => {
        if (session.timer) clearTimeout(session.timer)
        session.timer = scheduleExpiry()
    }

    paginationSessions.set(sessionId, session)
    return sessionId
}

let marketQueryCursor = 0
async function enqueueMarketQuery(type, commandText, query = '', timeoutMs = 15000) {
    const startWait = Date.now()
    const maxQueueWaitMs = 8000

    while (true) {
        const allBots = Array.from(activeBots.values())
        const smpReadyBots = allBots.filter(b => b.isInKingSMPReady())

        if (smpReadyBots.length === 0) {
            throw new Error('Chưa có bot nào vào **KingSMP**! Hãy gõ `!start all` hoặc đợi bot vào KingSMP rồi thử lại.')
        }

        const idleBots = smpReadyBots.filter(b => !b.pendingQuery)
        if (idleBots.length > 0) {
            const picked = idleBots[marketQueryCursor % idleBots.length]
            marketQueryCursor = (marketQueryCursor + 1) % 1000000
            return await picked.runGuiQuery({ type, commandText, query, timeoutMs })
        }

        if (Date.now() - startWait >= maxQueueWaitMs) {
            throw new Error('Tất cả các bot hiện đang bận xử lý yêu cầu khác. Vui lòng thử lại sau vài giây!')
        }

        await new Promise(r => setTimeout(r, 250))
    }
}

function initDiscordBot(context) {
    discordAppContext = context
    const token = discordConfig.token

    if (!token || token.includes('THAY_TOKEN')) {
        originalConsoleLog('\x1b[33m[DISCORD] Chưa cài đặt DISCORD_TOKEN (hãy thêm vào Environment Variables trên Render hoặc discord_render_config.json). Bỏ qua Discord Bot.\x1b[0m')
        return null
    }

    function startClient(withMessageContent = true) {
        const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
        if (withMessageContent) intents.push(GatewayIntentBits.MessageContent)

        const client = new Client({ intents })

        client.on('error', (err) => {
            originalConsoleLog(`\x1b[91m[DISCORD ERROR] ${err.message}\x1b[0m`)
        })

        client.once(Events.ClientReady, () => {
            originalConsoleLog(`\x1b[92m[DISCORD] Bot Discord đã online với tên: ${client.user.tag}\x1b[0m`)
            if (!withMessageContent) {
                originalConsoleLog(`\x1b[93m[DISCORD HƯỚNG DẪN] Chưa bật MESSAGE CONTENT INTENT -> Dùng cú pháp tag bot: @${client.user.username} !help hoặc bật intent trên Discord Developer Portal.\x1b[0m`)
            }
            if (discordConfig.alertChannelId) {
                const savedCh = client.channels.cache.get(discordConfig.alertChannelId)
                const me = savedCh?.guild?.members?.me
                const canUseSaved = Boolean(
                    savedCh && savedCh.isTextBased() &&
                    (!me || savedCh.permissionsFor(me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]))
                )
                if (!canUseSaved) {
                    originalConsoleLog(`\x1b[93m[DISCORD] Kênh cũ (${discordConfig.alertChannelId}) không truy cập được nữa -> Tự động tìm lại kênh chuẩn...\x1b[0m`)
                    discordConfig.alertChannelId = ''
                    saveDiscordConfig(discordConfig)
                }
            }
            if (!discordConfig.alertChannelId) {
                const matchedCh = client.channels.cache.find(
                    ch => ch.isTextBased() && typeof ch.name === 'string' &&
                        activeProfile.channelNames.includes(ch.name.toLowerCase())
                )
                if (matchedCh) {
                    discordConfig.alertChannelId = matchedCh.id
                    saveDiscordConfig(discordConfig)
                    originalConsoleLog(`[DISCORD] Tự động liên kết kênh #${matchedCh.name} (${matchedCh.id}) cho bot ${activeProfile.label}.`)
                }
            }
            if (discordConfig.alertChannelId) {
                sendDiscordAlert('🚀 Bot KingMC Khởi Động', `Hệ thống Bot KingMC (${activeProfile.label}) đã sẵn sàng nhận lệnh điều khiển. Gõ \`!help\` để xem danh sách lệnh.`, 0x2ED573)
            }
        })

        client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot) return
            const botId = client.user ? client.user.id : null
            const myRoles = message.guild?.members?.me?.roles?.cache
            const hasUserMention = Boolean(botId && message.mentions?.users?.has(botId))
            const matchedManagedRoles = myRoles
                ? [...(message.mentions?.roles?.values() || [])].filter(r => r.managed && myRoles.has(r.id))
                : []
            const hasBotMention = hasUserMention || matchedManagedRoles.length > 0
            const mentionsOtherUser = Boolean(message.mentions?.users?.size > 0 && !hasUserMention)
            const mentionsOtherManagedRole = Boolean(
                [...(message.mentions?.roles?.values() || [])].some(r => r.managed && (!myRoles || !myRoles.has(r.id)))
            )
            if (mentionsOtherUser || mentionsOtherManagedRole) return

            let content = message.content.trim()
            if (botId) {
                content = content.replace(new RegExp(`^<@!?${botId}>\\s*`), '').trim()
            }
            for (const r of matchedManagedRoles) {
                content = content.replace(new RegExp(`^<@&${r.id}>\\s*`), '').trim()
            }
            const prefix = discordConfig.prefix || '!'

            if (!content.startsWith(prefix)) return

            const rawWithoutPrefix = content.slice(prefix.length).trim()
            const args = rawWithoutPrefix.split(/\s+/)
            const command = args[0].toLowerCase()
            const subArgs = args.slice(1)
            const isSetChannelCmd = (command === 'setchannel' || command === 'here')

            // Khóa kênh riêng biệt theo profile Render
            const chNameLower = (message.channel.name || '').toLowerCase()
            const isIgnoredChannel = !activeProfile.channelNames.includes(chNameLower) &&
                activeProfile.ignoreChannelKeywords.some(k => chNameLower.includes(k))
            if (discordConfig.alertChannelId && message.channel.id !== discordConfig.alertChannelId) {
                const allowByKeyword = !isIgnoredChannel && activeProfile.allowSetChannelKeywords.some(k => chNameLower.includes(k))
                if (!(isSetChannelCmd && (hasBotMention || allowByKeyword))) return
            }

            // Tránh nhận nhầm kênh của bot khác nếu chưa cài kênh
            if (!discordConfig.alertChannelId && !hasBotMention) {
                if (isIgnoredChannel) return
            }

            if (!discordConfig.alertChannelId) {
                discordConfig.alertChannelId = message.channel.id
                saveDiscordConfig(discordConfig)
                originalConsoleLog(`[DISCORD] Tự động chọn kênh <#${message.channel.id}> làm kênh điều khiển & stream output.`)
            }

        // Lệnh: !help
        if (command === 'help' || command === 'h') {
            const embed = new EmbedBuilder()
                .setTitle('👑 HƯỚNG DẪN ĐIỀU KHIỂN BOT KINGMC')
                .setColor(0x5865F2)
                .setDescription('Bạn có thể điều khiển trực tiếp tất cả bot Minecraft từ Discord. Toàn bộ tin nhắn in-game & output CMD sẽ tự động stream vào kênh này!')
                .addFields(
                    {
                        name: '🔍 Tra cứu KingSMP (/order, /ah, /stats)',
                        value: '`!order <tên item>` : Check đơn đặt mua (`/order`) kèm nút `◀` `▶` chuyển trang\n`!ah <tên item>` : Check Chợ Đấu Giá (`/ah`) kèm nút `◀` `▶` chuyển trang\n`!stats <tên player>` : Xem chỉ số (`/stats`) của người chơi'
                    },
                    {
                        name: '💬 Gửi Chat & Lệnh Ingame (Không reply thừa, có icon ✅)',
                        value: '`!chat <số/tên> <lệnh>` : Gửi lệnh cho bot (ví dụ: `!chat 1 /bal` hoặc `!chat 1 /ah`)\n`!<số bot> <lệnh>` : Gửi nhanh (ví dụ: `!1 /bal` hoặc `!1 /menu`)\n`!chat all <lệnh>` : Gửi lệnh cho TẤT CẢ các bot đang online'
                    },
                    {
                        name: '📊 Trạng thái & Bảng thông tin',
                        value: '`!status` / `!list` : Xem trạng thái tổng quan các bot\n`!sb <số/tên/all>` : Xem Scoreboard (Money, Shards, Key, Ping...) chi tiết'
                    },
                    {
                        name: '📦 Túi đồ & GUI Menu',
                        value: '`!inv <số/tên>` : Xem danh sách vật phẩm trong túi đồ của bot\n`!click <số/tên> <slot>` : Click slot trong GUI đang mở\n`!close <số/tên>` : Đóng GUI của bot'
                    },
                    {
                        name: '⚙️ Quản lý Bot & Cài đặt',
                        value: '`!start <123/all/số>` : Khởi động bot (ví dụ: `!start 123` chạy 3 bot)\n`!stop <123/all/số>` : Dừng bot\n`!version [phiên bản]` : Xem hoặc đổi phiên bản Minecraft (Mặc định: 1.20.1)\n`!stream on/off` : Bật/tắt chế độ tự stream toàn bộ output CMD\n`!setchannel` : Đặt kênh chat này làm Kênh Thông Báo & Stream'
                    }
                )
                .setFooter({ text: 'KingMC AFK Bot (Render) • Quản lý từ xa 24/7' })
                .setTimestamp()

            return message.reply({ embeds: [embed] }).catch(() => {})
        }

        // Lệnh: !order <tên_item> hoặc !ah <tên_item>
        if (command === 'order' || command === 'ah') {
            const query = subArgs.join(' ').trim()
            if (!query) {
                const example = command === 'order' ? '`!order elytra` hoặc `!order blaze rod`' : '`!ah elytra` hoặc `!ah spawner`'
                return message.reply(`⚠️ Cú pháp: \`!${command} <tên vật phẩm>\`\nVí dụ: ${example}`).catch(() => {})
            }

            const label = command === 'order' ? `/order ${query}` : `/ah ${query}`
            const loadingMsg = await message.reply(`⏳ Đang quét **${label}** trên KingSMP...`).catch(() => null)

            try {
                const res = await discordAppContext.enqueueMarketQuery(command, label, query, 15000)
                const list = command === 'order' ? (res.orders || []) : (res.items || [])

                if (list.length === 0) {
                    const emptyEmbed = new EmbedBuilder()
                        .setTitle(`${command === 'order' ? '📦 Đơn hàng' : '🛒 Đấu Giá (AH)'}: **${query}**`)
                        .setColor(0xE74C3C)
                        .setDescription(`❌ Không tìm thấy kết quả nào cho **${query}**.`)
                        .setFooter({ text: `Bot: ${res.botUsername || 'KingMC'}` })
                        .setTimestamp()

                    if (loadingMsg) return loadingMsg.edit({ content: null, embeds: [emptyEmbed] }).catch(() => {})
                    return message.reply({ embeds: [emptyEmbed] }).catch(() => {})
                }

                const pages = chunkArray(list, 9)
                const totalPages = pages.length
                const embed = buildMarketEmbed({
                    type: command,
                    query,
                    pages,
                    pageIndex: 1,
                    totalCount: list.length,
                    botUsername: res.botUsername
                })

                if (totalPages > 1) {
                    const targetMsg = loadingMsg || await message.reply({ embeds: [embed] }).catch(() => null)
                    if (!targetMsg) return
                    const sessionId = createPaginationSession({
                        messageRef: targetMsg,
                        authorId: message.author.id,
                        type: command,
                        query,
                        pages,
                        totalCount: list.length,
                        botUsername: res.botUsername
                    })
                    const row = buildPaginationRow(sessionId, 1, totalPages)
                    return targetMsg.edit({ content: null, embeds: [embed], components: [row] }).catch(() => {})
                }

                if (loadingMsg) return loadingMsg.edit({ content: null, embeds: [embed] }).catch(() => {})
                return message.reply({ embeds: [embed] }).catch(() => {})
            } catch (err) {
                const errText = `❌ Lỗi khi quét **${label}**: ${err.message}`
                if (loadingMsg) return loadingMsg.edit({ content: errText }).catch(() => {})
                return message.reply(errText).catch(() => {})
            }
        }

        // Lệnh: !stats <tên_player>
        if (command === 'stats') {
            const targetPlayer = subArgs[0] ? subArgs[0].trim() : ''
            if (!targetPlayer) {
                return message.reply('⚠️ Cú pháp: `!stats <tên người chơi>`\nVí dụ: `!stats duykhang286`').catch(() => {})
            }

            const loadingMsg = await message.reply(`⏳ Đang tra cứu **/stats ${targetPlayer}**...`).catch(() => null)

            try {
                const res = await discordAppContext.enqueueMarketQuery('stats', `/stats ${targetPlayer}`, targetPlayer, 15000)

                if (res.notFound || !res.entries || res.entries.length === 0) {
                    const reasonText = res.message
                        ? `❌ ${res.message}`
                        : `❌ Không tìm thấy stats của **${targetPlayer}** hoặc người chơi chưa từng tham gia KingSMP.`
                    const errEmbed = new EmbedBuilder()
                        .setTitle(`✨ Stats: **${targetPlayer}**`)
                        .setThumbnail(res.avatarUrl || `https://mc-heads.net/head/${encodeURIComponent(targetPlayer)}/3d`)
                        .setColor(0xE74C3C)
                        .setDescription(reasonText)
                        .setFooter({ text: `Bot: ${res.botUsername || 'KingMC'}` })
                        .setTimestamp()

                    if (loadingMsg) return loadingMsg.edit({ content: null, embeds: [errEmbed] }).catch(() => {})
                    return message.reply({ embeds: [errEmbed] }).catch(() => {})
                }

                let desc = res.entries
                    .map(e => `• **${e.title.toUpperCase()}** | \`${e.value}\``)
                    .join('\n')
                if (desc.length > 4096) desc = desc.slice(0, 4080) + '...'

                const embed = new EmbedBuilder()
                    .setTitle(`✨ Stats: **${targetPlayer}**`)
                    .setThumbnail(res.avatarUrl || `https://mc-heads.net/head/${encodeURIComponent(targetPlayer)}/3d`)
                    .setColor(0x5865F2)
                    .setDescription(desc)
                    .setFooter({ text: `Bot: ${res.botUsername || 'KingMC'} • KingMC AFK Bot` })
                    .setTimestamp()

                if (loadingMsg) return loadingMsg.edit({ content: null, embeds: [embed] }).catch(() => {})
                return message.reply({ embeds: [embed] }).catch(() => {})
            } catch (err) {
                const errText = `❌ Lỗi khi kiểm tra **/stats ${targetPlayer}**: ${err.message}`
                if (loadingMsg) return loadingMsg.edit({ content: errText }).catch(() => {})
                return message.reply(errText).catch(() => {})
            }
        }

        // Lệnh: !stream / !live / !log
        if (command === 'stream' || command === 'live' || command === 'log') {
            const mode = subArgs[0] ? subArgs[0].toLowerCase() : ''
            if (mode === 'off' || mode === 'tat' || mode === 'tắt') {
                isStreamingEnabled = false
                discordConfig.streamLogs = false
                saveDiscordConfig(discordConfig)
                return message.reply('🔕 Đã **TẮT** chế độ live stream output CMD vào Discord.').catch(() => {})
            } else if (mode === 'on' || mode === 'bat' || mode === 'bật') {
                isStreamingEnabled = true
                discordConfig.streamLogs = true
                saveDiscordConfig(discordConfig)
                return message.reply('🔔 Đã **BẬT** chế độ live stream toàn bộ output CMD vào Discord!').catch(() => {})
            } else {
                return message.reply(`Live stream CMD hiện đang: **${isStreamingEnabled ? 'BẬT (ON)' : 'TẮT (OFF)'}**\nCách đổi: \`!stream on\` hoặc \`!stream off\``).catch(() => {})
            }
        }

        // Lệnh: !setchannel
        if (command === 'setchannel' || command === 'here') {
            discordConfig.alertChannelId = message.channel.id
            saveDiscordConfig(discordConfig)

            const embed = new EmbedBuilder()
                .setTitle('🔔 Đã cài đặt Kênh Thông Báo & Stream')
                .setColor(0x2ED573)
                .setDescription(`Kênh <#${message.channel.id}> đã được cài đặt làm kênh nhận thông báo, cảnh báo và live stream toàn bộ output CMD của Bot KingMC!`)
                .setTimestamp()

            return message.reply({ embeds: [embed] }).catch(() => {})
        }

        // Lệnh: !status / !list
        if (command === 'status' || command === 'list') {
            if (subArgs.length > 0) {
                return handleScoreboardCommand(message, subArgs.join(' '))
            }

            const { activeBots: ctxActiveBots, accounts: ctxAccounts } = discordAppContext
            let desc = ''

            ctxAccounts.forEach((acc, index) => {
                const id = index + 1
                const instance = ctxActiveBots.get(id)
                let statusIcon = '🔴'
                let statusText = 'Offline (Chưa chạy)'

                if (instance) {
                    if (instance.stoppedManually) {
                        statusIcon = '⏹️'
                        statusText = 'Đã dừng (Manual Stop)'
                    } else if (instance.maintenanceUntil > Date.now() && !instance.bot) {
                        const minsLeft = Math.max(1, Math.ceil((instance.maintenanceUntil - Date.now()) / 60000))
                        statusIcon = '🛠️'
                        statusText = `Nghỉ bảo trì (vào lại sau ~${minsLeft} phút)`
                    } else if (instance.inKingSMP) {
                        statusIcon = '🟢'
                        statusText = '**Online (KingSMP)**'
                    } else if (instance.loggedIn) {
                        statusIcon = '🟡'
                        statusText = 'Online (Sảnh Lobby)'
                    } else if (instance.reconnecting) {
                        statusIcon = '🔄'
                        statusText = 'Đang reconnect...'
                    } else if (instance.bot) {
                        statusIcon = '🌐'
                        statusText = 'Đang kết nối...'
                    }

                    if (instance.proxy && !instance.proxy.disabled) {
                        statusText += ` \`[Proxy: ${instance.proxy.host}:${instance.proxy.port}]\``
                    }
                }

                desc += `${statusIcon} **[${id}] ${acc.username}**: ${statusText}\n`
            })

            const embed = new EmbedBuilder()
                .setTitle('👑 DANH SÁCH TRẠNG THÁI CÁC BOT')
                .setColor(0x5865F2)
                .setDescription(desc || 'Không có account nào.')
                .setFooter({ text: 'Mẹo: Gõ !sb 1 hoặc !sb 123 để xem Bảng thông tin (Scoreboard)' })
                .setTimestamp()

            return message.reply({ embeds: [embed] }).catch(() => {})
        }

        // Lệnh: !sb <target> hoặc !scoreboard <target>
        if (command === 'sb' || command === 'scoreboard') {
            const target = subArgs.join(' ') || 'all'
            return handleScoreboardCommand(message, target)
        }

        // Xử lý gửi chat/lệnh: !chat <target> <lệnh> HOẶC cú pháp nhanh: !1 <lệnh>
        let isChatCommand = (command === 'chat' || command === 'cmd')
        let targetBotArg = ''
        let chatContent = ''

        if (isChatCommand) {
            if (subArgs.length < 2) {
                return message.reply('⚠️ Cú pháp: `!chat <số bot/tên bot/all> <lệnh>`\nVí dụ: `!chat 1 /bal` hoặc `!1 /bal`').catch(() => {})
            }
            targetBotArg = subArgs[0].toLowerCase()
            chatContent = subArgs.slice(1).join(' ')
        } else if (/^\d+$/.test(command)) {
            isChatCommand = true
            targetBotArg = command
            chatContent = subArgs.join(' ')
            if (!chatContent) return
        }

        if (isChatCommand && chatContent) {
            const { activeBots: ctxActiveBots, findBot: ctxFindBot, executeCommandOnBot: ctxExec } = discordAppContext

            if (targetBotArg === 'all') {
                for (const bot of ctxActiveBots.values()) {
                    if (bot.bot && !bot.stoppedManually && bot.isChatReady()) {
                        ctxExec(bot, chatContent)
                    }
                }
                return message.react('✅').catch(() => {})
            }

            const bot = ctxFindBot(targetBotArg)
            if (!bot) {
                message.react('❌').catch(() => {})
                return message.reply(`❌ Không tìm thấy bot \`${targetBotArg}\`. Gõ \`!status\` để xem danh sách.`).catch(() => {})
            }

            if (!bot.isChatReady()) {
                message.react('⚠️').catch(() => {})
                return message.reply(`⚠️ Bot **[${bot.username}]** đang kết nối hoặc offline, chưa sẵn sàng nhận chat/lệnh!`).catch(() => {})
            }

            ctxExec(bot, chatContent)
            return message.react('✅').catch(() => {})
        }

        // Lệnh: !click <target> <slot>
        if (command === 'click') {
            if (subArgs.length < 2) {
                return message.reply('⚠️ Cú pháp: `!click <số bot/tên bot> <slot>`\nVí dụ: `!click 1 24`').catch(() => {})
            }

            const target = subArgs[0]
            const slot = parseInt(subArgs[1])
            const bot = discordAppContext.findBot(target)

            if (!bot) {
                message.react('❌').catch(() => {})
                return message.reply(`❌ Không tìm thấy bot \`${target}\`.`).catch(() => {})
            }
            if (isNaN(slot)) {
                message.react('❌').catch(() => {})
                return message.reply('❌ Slot click phải là một số nguyên!').catch(() => {})
            }

            bot.click(slot)
            return message.react('✅').catch(() => {})
        }

        // Lệnh: !close <target>
        if (command === 'close') {
            if (subArgs.length < 1) return message.reply('⚠️ Cú pháp: `!close <số bot/tên bot>`').catch(() => {})
            const bot = discordAppContext.findBot(subArgs[0])
            if (!bot) {
                message.react('❌').catch(() => {})
                return message.reply(`❌ Không tìm thấy bot \`${subArgs[0]}\`.`).catch(() => {})
            }

            bot.close()
            return message.react('✅').catch(() => {})
        }

        // Lệnh: !inv <target>
        if (command === 'inv' || command === 'inventory') {
            if (subArgs.length < 1) return message.reply('⚠️ Cú pháp: `!inv <số bot/tên bot>`').catch(() => {})
            const bot = discordAppContext.findBot(subArgs[0])
            if (!bot) return message.reply(`❌ Không tìm thấy bot \`${subArgs[0]}\`.`).catch(() => {})

            if (!bot.bot || !bot.bot.inventory) {
                return message.reply(`❌ Bot **[${bot.username}]** chưa vào server hoặc túi đồ chưa tải xong.`).catch(() => {})
            }

            const items = bot.bot.inventory.items()
            if (items.length === 0) {
                return message.reply(`🎒 **[${bot.username}]** Túi đồ hiện đang trống!`).catch(() => {})
            }

            let invText = items.slice(0, 25).map(it => `Slot ${it.slot}: x${it.count} ${it.displayName || it.name}`).join('\n')
            if (items.length > 25) invText += `\n... và còn ${items.length - 25} items khác`

            const embed = new EmbedBuilder()
                .setTitle(`🎒 TÚI ĐỒ: [${bot.username}] (${items.length} items)`)
                .setColor(0xF39C12)
                .setDescription(`\`\`\`text\n${invText}\n\`\`\``)
                .setTimestamp()

            return message.reply({ embeds: [embed] }).catch(() => {})
        }

        // Lệnh: !start <target>
        if (command === 'start' || command === 'run') {
            const rawTarget = subArgs.join(' ') || 'all'
            const {
                accounts: ctxAccounts,
                activeBots: ctxActiveBots,
                startSelectedAccounts: ctxStartSelected,
                setupCommandLine: ctxSetupCmd,
                COLORS: ctxColors,
                BotInstance: CtxBotClass,
                currentProxy: ctxProxy
            } = discordAppContext
            const indices = parseAccountIndices(rawTarget, ctxAccounts)

            if (indices.length === 0) {
                const listStr = ctxAccounts.map((a, i) => `**${i + 1}.** ${a.username}`).join(' | ')
                return message.reply(`❌ Không tìm thấy bot nào khớp với \`${rawTarget}\`.\nDanh sách bot: ${listStr}`).catch(() => {})
            }

            const botNames = indices.map(i => `**[${i + 1}] ${ctxAccounts[i].username}**`)
            const gapSec = IS_RENDER_ENV ? 12 : 3
            message.reply(`▶️ Đang khởi chạy ${indices.length} bot: ${botNames.join(', ')}... (Cách nhau ${gapSec}s để tránh bị chặn IP)`).catch(() => {})

            if (typeof ctxStartSelected === 'function') {
                ctxStartSelected(indices).then(() => {
                    if (typeof ctxSetupCmd === 'function') {
                        ctxSetupCmd()
                    }
                }).catch(err => {
                    console.error('[DISCORD START ERROR]', err)
                })
            } else {
                ;(async () => {
                    for (let i = 0; i < indices.length; i++) {
                        const accIndex = indices[i]
                        const acc = ctxAccounts[accIndex]
                        const id = accIndex + 1
                        const color = ctxColors ? ctxColors[accIndex % ctxColors.length] : ''

                        let botInstance = ctxActiveBots.get(id)
                        if (!botInstance && CtxBotClass) {
                            botInstance = new CtxBotClass(id, acc, color)
                            ctxActiveBots.set(id, botInstance)
                        }
                        if (botInstance) {
                            if (ctxProxy) botInstance.proxy = { ...ctxProxy }
                            botInstance.start()
                        }
                        if (i < indices.length - 1) {
                            await new Promise(r => setTimeout(r, 3000))
                        }
                    }
                    if (typeof ctxSetupCmd === 'function') {
                        ctxSetupCmd()
                    }
                })()
            }
            return
        }

        // Lệnh: !stop <target>
        if (command === 'stop') {
            const rawTarget = subArgs.join(' ')
            if (!rawTarget) return message.reply('⚠️ Cú pháp: `!stop <số bot/tên bot/all>` (ví dụ: `!stop 123` hoặc `!stop 1` hoặc `!stop all`)').catch(() => {})

            const { accounts: ctxAccounts, activeBots: ctxActiveBots } = discordAppContext
            const indices = parseAccountIndices(rawTarget, ctxAccounts)

            if (indices.length === 0) {
                return message.reply(`❌ Không tìm thấy bot nào khớp với \`${rawTarget}\`.`).catch(() => {})
            }

            const stoppedNames = []
            for (const idx of indices) {
                const id = idx + 1
                const bot = ctxActiveBots.get(id)
                if (bot && bot.bot && !bot.stoppedManually) {
                    bot.stop()
                    stoppedNames.push(`**[${id}] ${ctxAccounts[idx].username}**`)
                }
            }

            if (stoppedNames.length === 0) {
                return message.reply('⚠️ Các bot được chọn hiện đều đang không chạy.').catch(() => {})
            }

            return message.reply(`⏹️ Đã dừng ${stoppedNames.length} bot: ${stoppedNames.join(', ')}.`).catch(() => {})
        }

        // Lệnh: !proxy
        if (command === 'proxy') {
            const { currentProxy: ctxProxy } = discordAppContext
            if (ctxProxy && !ctxProxy.disabled) {
                const auth = ctxProxy.userId ? ` (User: \`${ctxProxy.userId}\`)` : ''
                return message.reply(`🌐 **Proxy SOCKS5 hiện tại:** \`${ctxProxy.host}:${ctxProxy.port}\`${auth}`).catch(() => {})
            } else {
                return message.reply('🌐 Hiện tại **chưa bật Proxy** (Các bot đang kết nối trực tiếp qua IP Render).').catch(() => {})
            }
        }

        // Lệnh: !version
        if (command === 'version' || command === 'ver') {
            const { MC_VERSION: ctxVer, setMCVersion: ctxSetVer } = discordAppContext
            const newVer = subArgs[0] ? subArgs[0].trim() : ''
            if (!newVer) {
                return message.reply(`🎮 **Phiên bản Minecraft hiện tại:** \`${ctxVer || '1.20.1'}\`\n💡 Mẹo: Phiên bản tối ưu nhất cho KingMC hiện tại là \`1.20.1\`\nĐổi bản khác: \`!version 1.20.1\` hoặc \`!version 1.19.4\``).catch(() => {})
            } else {
                if (typeof ctxSetVer === 'function') {
                    ctxSetVer(newVer)
                }
                return message.reply(`✅ Đã cập nhật phiên bản Minecraft sang: **\`${newVer}\`**.\nPhiên bản sẽ được áp dụng khi bot kết nối lại hoặc khởi động mới.`).catch(() => {})
            }
        }
    })

    // Xử lý nút bấm chuyển trang ◀ / ▶ cho !order và !ah
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isButton()) return
        const customId = interaction.customId || ''
        const match = customId.match(/^page_(.+)_(prev|next|indicator)$/)
        if (!match) return

        const sessionId = match[1]
        const action = match[2]
        if (action === 'indicator') {
            return interaction.deferUpdate().catch(() => {})
        }

        const session = paginationSessions.get(sessionId)
        if (!session || !session.pages) {
            return interaction.reply({
                content: '⌛ Phiên xem trang đã hết hạn (5 phút). Vui lòng gõ lại lệnh!',
                flags: 64
            }).catch(() => {})
        }

        const nextPage = action === 'prev'
            ? Math.max(1, session.currentPage - 1)
            : Math.min(session.totalPages, session.currentPage + 1)

        if (nextPage === session.currentPage) {
            return interaction.deferUpdate().catch(() => {})
        }

        session.currentPage = nextPage
        session.resetTimer()

        const embed = buildMarketEmbed({
            type: session.type,
            query: session.query,
            pages: session.pages,
            pageIndex: nextPage,
            totalCount: session.totalCount,
            botUsername: session.botUsername
        })
        const row = buildPaginationRow(sessionId, nextPage, session.totalPages)

        await interaction.update({ embeds: [embed], components: [row] }).catch(() => {})
    })

    function handleScoreboardCommand(message, target) {
        const { accounts: ctxAccounts, activeBots: ctxActiveBots, extractScoreboardData: ctxExtractSb } = discordAppContext
        const str = target || 'all'
        let indices = []

        if (str.toLowerCase() === 'all') {
            indices = ctxAccounts.map((_, i) => i)
        } else if (/^\d+$/.test(str) && str.length > 1) {
            for (const ch of str.split('')) {
                const n = parseInt(ch)
                if (n >= 1 && n <= ctxAccounts.length) {
                    const idx = n - 1
                    if (!indices.includes(idx)) indices.push(idx)
                }
            }
        } else {
            const num = parseInt(str)
            if (!isNaN(num) && num >= 1 && num <= ctxAccounts.length) {
                indices = [num - 1]
            } else {
                const idx = ctxAccounts.findIndex(a => a.username.toLowerCase() === str.toLowerCase())
                if (idx !== -1) indices = [idx]
            }
        }

        if (indices.length === 0) {
            return message.reply(`❌ Không tìm thấy bot \`${target}\`. Gõ \`!status\` để xem danh sách.`).catch(() => {})
        }

        for (const idx of indices) {
            const id = idx + 1
            const bot = ctxActiveBots.get(id)
            const accName = ctxAccounts[idx]?.username || `Bot ${id}`

            if (!bot || !bot.bot) {
                const embed = new EmbedBuilder()
                    .setTitle(`📊 BẢNG THÔNG TIN: [${accName}]`)
                    .setColor(0xE74C3C)
                    .setDescription(`🔴 Bot hiện đang **Offline (Chưa chạy)**.\nGõ \`!start ${id}\` để bật bot.`)
                    .setTimestamp()

                message.reply({ embeds: [embed] }).catch(() => {})
                continue
            }

            let sb = null
            if (bot.bot.scoreboard?.sidebar) {
                sb = bot.bot.scoreboard.sidebar
            } else if (bot.bot.scoreboards) {
                const possibleNames = ['kmsb', 'TAB-Scoreboard']
                for (const name of possibleNames) {
                    if (bot.bot.scoreboards[name]) {
                        sb = bot.bot.scoreboards[name]
                        break
                    }
                }
                if (!sb) {
                    const allKeys = Object.keys(bot.bot.scoreboards)
                    if (allKeys.length > 0) sb = bot.bot.scoreboards[allKeys[0]]
                }
            }

            if (!sb || !sb.items || sb.items.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`📊 BẢNG THÔNG TIN: [${bot.username}]`)
                    .setColor(0xE67E22)
                    .setDescription('*(Chưa nhận được dữ liệu bảng thông tin từ server)*\n\n' +
                        `Trạng thái: **${bot.inKingSMP ? 'Đã vào KingSMP' : 'Chưa vào cụm SMP (Đang ở sảnh)'}**`)
                    .setTimestamp()

                message.reply({ embeds: [embed] }).catch(() => {})
                continue
            }

            const data = ctxExtractSb(sb.items)

            const embed = new EmbedBuilder()
                .setTitle(`📊 BẢNG THÔNG TIN: [${bot.username}]`)
                .setColor(0x00FFA2)
                .addFields(
                    { name: '💰 Money', value: `\`${data.money || '$ 0'}\``, inline: true },
                    { name: '💎 Shards', value: `\`${data.shards || '0'}\``, inline: true },
                    { name: '⚔️ Kill / Die', value: `Kill \`${data.kill || '0'}\` • Die \`${data.die || '0'}\``, inline: true },
                    { name: '🔑 Key', value: `\`${data.keyTime || '0m 0s'}\``, inline: true },
                    { name: '⏱️ Online', value: `\`${data.onlineTime || '0h'}\``, inline: true },
                    { name: '👥 Team', value: `\`${data.team || 'None'}\``, inline: true },
                    { name: '📶 Ping', value: `\`${data.ping || '0'} ms\``, inline: true },
                    { name: '🗺️ Vị trí', value: bot.inKingSMP ? '🟢 **KingSMP**' : '🟡 **Sảnh Chờ (Lobby)**', inline: true }
                )
                .setFooter({ text: 'KingMC AFK Bot' })
                .setTimestamp()

            message.reply({ embeds: [embed] }).catch(() => {})
        }
    }

        client.login(token).catch(err => {
            if (withMessageContent && err.message && err.message.includes('Used disallowed intents')) {
                originalConsoleLog('\x1b[93m[DISCORD CẢNH BÁO] Bot chưa bật "MESSAGE CONTENT INTENT" trên Discord Developer Portal! Đang tự động kết nối ở chế độ @mention (@bot !lệnh)...\x1b[0m')
                try { client.destroy() } catch (_) {}
                return startClient(false)
            }
            originalConsoleLog(`\x1b[91m[DISCORD ERROR] Không thể đăng nhập Discord Bot: ${err.message}\x1b[0m`)
        })

        discordClient = client
        return client
    }

    return startClient(true)
}


// ========================================
// HTTP KEEP-ALIVE SERVER CHO RENDER (PORT / HEALTH CHECK)
// ========================================

function startRenderHttpServer() {
    const port = parseInt(process.env.PORT || '', 10) || 3000
    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0]
        if (reqPath === '/' || reqPath === '/health' || reqPath === '/ping') {
            const payload = {
                status: 'OK',
                platform: 'render',
                profile: BOT_PROFILE,
                uptimeSeconds: Math.floor(process.uptime()),
                discordReady: Boolean(discordClient && discordClient.isReady()),
                bots: accounts.map((acc, idx) => {
                    const inst = activeBots.get(idx + 1)
                    return {
                        id: idx + 1,
                        username: acc.username,
                        online: Boolean(inst?.bot && !inst.stoppedManually),
                        inKingSMP: Boolean(inst?.inKingSMP),
                        loggedIn: Boolean(inst?.loggedIn)
                    }
                }),
                timestamp: new Date().toISOString()
            }
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            })
            if (req.method === 'HEAD') {
                return res.end()
            }
            return res.end(JSON.stringify(payload))
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end('Not Found')
    })

    server.on('error', (err) => {
        originalConsoleError(`[HTTP ERROR] Không thể mở cổng ${port}: ${err.message}`)
    })

    server.listen(port, '0.0.0.0', () => {
        originalConsoleLog(`\x1b[92m[RENDER HTTP] Keep-Alive server đang lắng nghe tại 0.0.0.0:${port} (/health)\x1b[0m`)
    })

    return server
}


// ========================================
// START
// ========================================

// 1. Mở HTTP server ngay lập tức để Render nhận diện cổng & nhận ping giữ sống
startRenderHttpServer()

// 2. Khởi động tích hợp Bot Discord
initDiscordBot({
    activeBots,
    accounts,
    findBot,
    executeCommandOnBot,
    startSingleBot,
    startSelectedAccounts,
    setupCommandLine,
    COLORS,
    BotInstance,
    get currentProxy() { return currentProxy },
    get MC_VERSION() { return MC_VERSION },
    setMCVersion(v) { MC_VERSION = v },
    extractScoreboardData,
    getText,
    enqueueMarketQuery
})

// 3. Tự động khởi chạy bot nếu đang chạy trên Render / Non-TTY hoặc có biến AUTO_START
;(async () => {
    const rawAuto = process.env.AUTO_START !== undefined
        ? String(process.env.AUTO_START).trim()
        : (IS_RENDER_ENV ? 'all' : '')

    if (rawAuto) {
        const lowerAuto = rawAuto.toLowerCase()
        if (['off', 'none', 'false', '0', 'no'].includes(lowerAuto)) {
            originalConsoleLog('[SYSTEM] AUTO_START=off -> Chờ lệnh !start từ Discord.')
            if (rl) setupCommandLine()
            return
        }

        let indices = parseAccountIndices(rawAuto, accounts)
        if (indices.length === 0) indices = accounts.map((_, i) => i)
        if (indices.length > 3 && !currentProxy) {
            originalConsoleLog('[SYSTEM] KingMC giới hạn tối đa 3 acc / 1 IP -> Chỉ tự động bật 3 acc đầu tiên.')
            indices = indices.slice(0, 3)
        }

        await startSelectedAccounts(indices)
        if (rl) setupCommandLine()
    } else if (rl) {
        selectAccount()
    }
})()