const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.wnao2sy.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("club_hub_db");
    const clubsCollection = db.collection("clubs");
    const eventsCollection = db.collection("events");

    // clubs api
    app.get("/clubs", async (req, res) => {
      const result = await clubsCollection.find().toArray();
      console.log("from DB", result);
      res.send(result);
    });
    // club details api
    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // featured-clubs
    app.get("/featured-clubs", async (req, res) => {
      const result = await clubsCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    app.post("/clubs", async (req, res) => {
      const club = req.body;
      console.log("New Club", club);
      const result = await clubsCollection.insertOne(club);
      res.send(result);
    });

    // all upcoming events
    app.get("/events", async (req, res) => {
      const today = new Date();
      const result = await eventsCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ClubHub server is connected!");
});

app.listen(port, () => {
  console.log(`ClubHub app listening on port ${port}`);
});
