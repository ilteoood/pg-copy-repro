import { randomUUID } from 'crypto'
import knex from 'knex'
import Papa from 'papaparse'
import pgCopyStreams from 'pg-copy-streams'
import { PassThrough, Readable, Transform, pipeline } from 'stream'
import { pipeline as asyncPipeline } from 'stream/promises'

const ACTIVITIES = 100
const CONSUMPTIONS = 1000

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
    await knexInstance.raw('create extension if not exists "uuid-ossp"')
    await knexInstance.schema.dropTableIfExists('activities_consumptions')
    await knexInstance.schema.dropTableIfExists('activities')

    await knexInstance.schema.createTable('activities', (table) => {
        table.uuid('id').defaultTo(knexInstance.raw('uuid_generate_v4()')).primary()
        table.string('name')
    })

    await knexInstance.schema.createTable('activities_consumptions', (table) => {
        table.uuid('id').defaultTo(knexInstance.raw('uuid_generate_v4()')).primary()
        table.uuid('activity_id').references('id').inTable('activities')
        table.double('consumption')
    })
}

const generateData = () => {
    return Readable.from(function* generator() {
        for (let i = 0; i < ACTIVITIES; i++) {

            const activityId = randomUUID()

            const activity = {
                id: activityId,
                name: `Activity ${i}`,
                consumptions: []
            }

            for (let k = 0; k < CONSUMPTIONS; k++) {
                activity.consumptions.push({
                    activity_id: activityId,
                    consumption: Math.random()
                })
            }

            yield activity
        }
    }(), { objectMode: true })
}

const transformStream = (dataStream) => {
    let isFirstActivity = true
    let isFirstConsumption = true

    const activitiesStream = pipeline(
        dataStream.pipe(new PassThrough({objectMode: true})),
        new Transform({
            objectMode: true,
            transform: ({consumptions, ...toInsert}, _, callback) => {
                const csvData = Papa.unparse([toInsert], { header: false })

                callback(null, isFirstActivity ? csvData : `\n${csvData}`)
                isFirstActivity = false
            }
        }),
        console.log
    )

    const consumptionsStream = pipeline(
        dataStream.pipe(new PassThrough({objectMode: true})),
        new Transform({
            objectMode: true,
            transform: (data, _, callback) => {
                const csvData = Papa.unparse(data.consumptions, { header: false })

                callback(null, isFirstConsumption ? csvData : `\n${csvData}`)
                isFirstConsumption = false
            }
        }),
        console.log
    )

    return { activitiesStream, consumptionsStream }
}

const insertData = async ({ activitiesStream, consumptionsStream }) => {
    const transaction = await knexInstance.transaction()
    const client = await transaction.client.acquireConnection()

    const activitiesCopy = client.query(pgCopyStreams.from('COPY activities (id, name) FROM STDIN WITH (FORMAT csv)'))
    const consumptionsCopy = client.query(pgCopyStreams.from('COPY activities_consumptions (activity_id, consumption) FROM STDIN WITH (FORMAT csv)'))

    try {
        await Promise.all([
            asyncPipeline(activitiesStream, activitiesCopy),
            asyncPipeline(consumptionsStream, consumptionsCopy)
        ]);
        await transaction.commit();
    } catch (e) {
        console.error(e)
        await transaction.rollback();

        throw e;
    }
}

const main = async () => {
    console.log('Creating tables')
    await init()

    console.log('Generating data')
    const dataStream = generateData();

    console.log('Transforming data')
    const transformedStream = transformStream(dataStream)

    console.log('Inserting data')
    await insertData(transformedStream)

    await knexInstance.destroy()

    console.log('Done')
}

await main()