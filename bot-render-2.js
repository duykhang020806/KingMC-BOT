// Entrypoint cho bot-render-2 (mahira01)
if (!process.env.BOT_PROFILE) {
    process.env.BOT_PROFILE = 'render2'
}

require('./bot-render.js')
