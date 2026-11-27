// Entrypoint cho Render #2 (thay thế bot-oppo: _Mahiruu_, _Mahiruuu_)
if (!process.env.BOT_PROFILE) {
    process.env.BOT_PROFILE = 'oppo'
}

require('./bot-render.js')
