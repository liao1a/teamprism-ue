const mysql = require("mysql")
const fs = require("fs")
/**
 * 连接数据库
 * 
 * @param {Boolean} readonly 
 * @param {String} path 
 */
function connect(readonly, path) {
    if (!fs.existsSync(path)) {
        return false
    }
    const fileConfig = fs.readFileSync(path)
    const oCusConfig = JSON.parse(fileConfig)
    let oConnConfig = (readonly === true && oCusConfig.read) ? oCusConfig.read : oCusConfig.master

    if (oConnConfig.supportBigNumbers === undefined)
        oConnConfig.supportBigNumbers = true
    if (oConnConfig.bigNumberStrings === undefined)
        oConnConfig.bigNumberStrings = true

    let conn = mysql.createConnection(oConnConfig)

    return new Promise((resolve, reject) => {
        conn.connect(err => {
            if (err)
                reject(err)
            else
                resolve(conn)
        })
    })
}

/**
 * where条件
 */
const WhereMatchOps = ['=', '>', '>=', '<', '<=', '<>', 'like']
class WhereAssembler {

    constructor() {
        this.pieces = []
    }

    fieldMatch(field, op, match) {
        if (WhereMatchOps.indexOf(op) === -1 || !/number|string/.test(typeof match))
            return this

        this.pieces.push(`${field}${op}'${match}'`)
        return this
    }

    fieldIn(field, match) {
        this.pieces.push(`${field} in('${match.join('\',\'')}')`)
        return this
    }

    fieldNotIn(field, match) {
        this.pieces.push(`${field} not in('${match.join('\',\'')}')`)
        return this
    }

    fieldBetween(field, match) {
        this.pieces.push(`${field} between ${match[0]} and ${match[1]}`)
        return this
    }

    fieldNotBetween(field, match) {
        this.pieces.push(`${field} not between ${match[0]} and ${match[1]}`)
        return this
    }

    exists(match) {
        this.pieces.push(`exists('${match}')`)
        return this
    }

    and(match) {
        if (!Array.isArray(match) || match.length === 0)
            return this

        let subs = match.filter(sub => typeof sub === 'string')

        if (subs.length === 0)
            return this

        this.pieces.push(`(${subs.join(' and ')})`)
        return this

    }

    or(match) {
        if (!Array.isArray(match) || match.length <= 1)
            return this

        let subs = match.filter(sub => typeof sub === 'string')

        if (subs.length <= 1)
            return this

        this.pieces.push(`(${subs.join(' or ')})`)
        return this
    }

    get sql() {
        return this.pieces.join(' and ');
    }
}
class SqlAction {
    constructor(db, table) {
        this.db = db
        this.conn = db.conn
        this.table = table
    }

    exec() {
        return new Promise((resolve, reject) => {
            if (this.db.debug) {
                this.db.execSqlStack = this.sql
                resolve([])
            } else
                this.conn.query(this.sql, (error, result) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(result)
                    }
                })
        })
    }
}

class Insert extends SqlAction {

    constructor(db, table, data = {}) {
        super(db, table)
        this.data = data
    }

    get sql() {
        const fields = Object.keys(this.data)
        const values = fields.map(f => this.data[f])

        return `insert into ${this.table}(${fields.join(',')}) values('${values.join("','")}')`
    }
    exec(isAutoIncId = false) {
        return new Promise((resolve, reject) => {
            if (this.db.debug) {
                this.db.execSqlStack = this.sql
                resolve()
            } else
                this.conn.query(this.sql, (error, result) => {
                    if (error) {
                        reject(error)
                    } else {
                        if (isAutoIncId)
                            resolve(result.insertId)
                        else
                            resolve(result.affectedRows)
                    }
                })
        })
    }
}

class SqlActionWithWhere extends SqlAction {

    constructor(db, table) {
        super(db, table)
    }

    get where() {
        if (!this.whereAssembler)
            this.whereAssembler = new WhereAssembler()
        return this.whereAssembler
    }
}

class Delete extends SqlActionWithWhere {

    constructor(db, table) {
        super(db, table)
    }

    get sql() {
        return `delete from ${this.table} where ${this.where.sql}`
    }

}

class Update extends SqlActionWithWhere {

    constructor(db, table, data = {}) {
        super(db, table)
        this.data = data
    }

    get sql() {
        const fields = Object.keys(this.data)
        const pairs = fields.map(f => `${f}='${this.data[f]}'`)

        return `update ${this.table} set ${pairs.join(",")} where ${this.where.sql}`
    }
    exec() {
        return new Promise((resolve, reject) => {
            if (this.db.debug) {
                this.db.execSqlStack = this.sql
                resolve(0)
            } else
                this.conn.query(this.sql, (error, result) => {
                    if (error) {
                        reject(error)
                    } else {
                        resolve(result.affectedRows)
                    }
                })
        })
    }
}

class Select extends SqlActionWithWhere {

    constructor(db, table, fields) {
        super(db, table)
        this.fields = fields
        this.groupBy = ''
        this.orderBy = ''
        this.limitVal = ''
    }

    group(group = null) {
        if (group && typeof group === 'string') {
            this.groupBy = ` GROUP BY ` + group
        }
    }

    order(order = null) {
        if (order && typeof order === 'string') {
            this.orderBy = ` ORDER BY ` + order
        }
    }

    limit(offset = null, length = null) {
        if ((typeof offset === 'number' && !isNaN(offset)) && (typeof length === 'number' && !isNaN(length))) {
            this.limitVal = ` LIMIT ${offset},${length}`
        }
    }

    get sql() {
        let sql = `SELECT ${this.fields} FROM ${this.table} WHERE ${this.where.sql}`
        if (this.groupBy)
            sql += `${this.groupBy}`
        if (this.orderBy)
            sql += `${this.orderBy}`
        if (this.limitVal)
            sql += `${this.limitVal}`
        return sql
    }
}
class SelectOne extends Select {
    exec() {
        return new Promise((resolve, reject) => {
            super.exec().then((rows) => {
                if (rows.length === 1)
                    resolve(rows[0])
                else if (rows.length === 0)
                    resolve(false)
                else
                    reject('查询条件错误，获得多条数据')
            })
        })
    }
}
class SelectOneVal extends Select {
    exec() {
        return new Promise((resolve, reject) => {
            super.exec().then((rows) => {
                if (rows.length === 1)
                    resolve(Object.values(rows[0])[0])
                else if (rows.length === 0)
                    resolve(false)
                else
                    reject('查询条件错误，获得多条数据')
            })
        })
    }
}
// 执行模式，debug=true连接数据库
const DEBUG_MODE = Symbol('debug_mode')
// 数据库连接
const MYSQL_CONN = Symbol('mysql_conn')
// 记录执行的SQL
const EXEC_SQL_STACK = Symbol('exec_sql_stack')

class Db {
    constructor(conn, debug = false) {
        this[MYSQL_CONN] = conn
        this[DEBUG_MODE] = debug
    }
    get conn() {
        return this[MYSQL_CONN]
    }
    get debug() {
        return this[DEBUG_MODE]
    }
    set execSqlStack(sql) {
        if (undefined === this[EXEC_SQL_STACK]) this[EXEC_SQL_STACK] = []
        this[EXEC_SQL_STACK].push(sql)
    }
    get execSqlStack() {
        return this[EXEC_SQL_STACK]
    }

    static async build(readonly, path, debug) {
        let conn
        if (debug)
            conn = null
        else
            conn = await connect(readonly, path);

        return new Db(conn, debug)
    }

    end(done) {
        if (this.conn)
            this.conn.end(done)
        else if (done)
            done()
        delete this[EXEC_SQL_STACK]
    }

    newInsert(table, data) {
        return new Insert(this, table, data)
    }

    newDelete(table) {
        return new Delete(this, table)
    }

    newUpdate(table, data) {
        return new Update(this, table, data)
    }

    newSelect(table, fields) {
        return new Select(this, table, fields)
    }

    newSelectOne(table, fields) {
        return new SelectOne(this, table, fields)
    }

    newSelectOneVal(table, fields) {
        return new SelectOneVal(this, table, fields)
    }
}

module.exports = async function({
    readonly = false,
    path = process.cwd() + "/cus/db.json",
    debug = false
} = {}) {
    try {
        let db = Db.build(readonly, path, debug)
        return db
    } catch (err) {
        return false
    }
}