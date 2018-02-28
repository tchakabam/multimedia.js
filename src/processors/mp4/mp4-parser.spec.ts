import 'should';

const fs = require('fs')
const path = require('path')

import {MP4Parser} from './mp4-parser'

import {ISOFile} from './isoboxer-types'

describe('MP4Parser', () => {
  const mp4TestData = []

  beforeAll((done) => {
    fs.readFile(path.resolve('./src/processors/mp4/fixtures/v-0360p-0750k-libx264.mp4'), (err, data) => {

      if (err) {
        throw err
      }

      mp4TestData.push(new Uint8Array(data.buffer))

      done()
    })
  })

  it('should parse an MP4 file without errors', () => {
    const res: ISOFile = MP4Parser.parse(mp4TestData[0])
    //console.log(res)
    // TODO: perform validation
  })
})