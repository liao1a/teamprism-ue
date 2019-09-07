const { ResultData, ResultFault, ResultObjectNotFound } = require('../../../tms/api')
const Base = require('../base')

class Main extends Base {
    constructor(...args) {
        super(...args)
    }
    async tmsBeforeEach() {
        let { app } = this.request.query
        if (!app)
            return new ResultFault(`参数错误`)

        let dbLink = this.model('matter/link')
        const oLink = await dbLink.byId(app)
        dbLink.end()
        if (!oLink || oLink.state !== 1)
            return new ResultObjectNotFound()

        this.channel = oLink

        return true
    }
    /**
     * 
     */
    async get() {
        return new ResultData(this.channel)
    }
}

module.exports = Main