import cloudbase from '@cloudbase/js-sdk'

const app = cloudbase.init({
  env: 'chenzezhineng-d9g5u1dt34eb52837'
})

const db = app.database()
const _ = db.command

export { app, db, _ }
