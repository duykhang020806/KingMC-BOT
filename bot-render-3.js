// Entrypoint cho bot-render-3 (mahira02)
if (!process.env.BOT_PROFILE) {
    process.env.BOT_PROFILE = 'render3'
}

require('./bot-render.js')
