import knex from 'knex'

const knexInstance = knex({
    client: 'pg',
    connection: {
        user: 'postgres',
        password: 'postgres',
        host: 'localhost',
        port: 5432,
        database: 'postgres'
    },
    pool: { min: 0, max: 10 }
})

const init = async () => {
    await knexInstance.schema.dropTableIfExists('activities')
    await knexInstance.schema.createTable('activities', (table) => {
        table.uuid('id')
        table.string('name')
    })

    await knexInstance.schema.dropTableIfExists('activities_consumptions')
    await knexInstance.schema.createTable('activities_consumptions', (table) => {
        table.uuid('id')
        table.uuid('activity_id').references('id').inTable('activities')
        table.integer('consumption')
    })
}

const generateData = async () => {

}

const main = async () => {
    await init()
}