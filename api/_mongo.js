import { MongoClient } from 'mongodb'

let clientPromise

export function getMongoClient() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured')
  }

  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI)
    clientPromise = client.connect()
  }

  return clientPromise
}

export function getDatabaseName() {
  return process.env.MONGODB_DB || 'vedryx'
}
