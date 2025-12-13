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
    const userCollection = db.collection("users");
    const clubsCollection = db.collection("clubs");
    const eventsCollection = db.collection("events");
    const registrationsCollection = db.collection("registrations");

    // user api
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "member";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      res.send(user);
    });

    // user role api
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ role: null });
      }
      res.send({ role: user.role });
    });

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
      const result = await eventsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/events/:id", async (req, res) => {
      const eventId = req.params.id;
      const result = await eventsCollection.findOne({
        _id: new ObjectId(eventId),
      });

      res.send(result);
    });

    // create event api
    app.post("/events", async (req, res) => {
      const event = req.body;
      const club = await clubsCollection.findOne({
        managerEmail: event.managerEmail,
      });

      if (!club) {
        return res
          .status(404)
          .send({ message: "Club not found for this manager" });
      }

      const newEvent = {
        ...event,
        clubId: club._id.toString(),
        createdAt: new Date(),
      };

      const result = await eventsCollection.insertOne(newEvent);
      res.send(result);
    });

    // event register api
    app.post("/event-registrations", async (req, res) => {
      try {
        const { eventId, userEmail, paymentId } = req.body;

        if (!eventId || !userEmail) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const event = await eventsCollection.findOne({
          _id: new ObjectId(eventId),
        });
        if (!event) return res.status(404).send({ message: "Event not found" });

        const alreadyRegistered = await registrationsCollection.findOne({
          eventId,
          userEmail,
          status: "registered",
        });

        if (alreadyRegistered) {
          return res
            .status(400)
            .send({ message: "Already registered for this event" });
        }

        const registration = {
          eventId: eventId,
          userEmail: userEmail,
          clubId: event.clubId,
          status: "registered",
          // paymentId: paymentId || null,
          registeredAt: new Date(),
        };
        const result = await registrationsCollection.insertOne(registration);

        res.send({
          message: "Registration successful",
          registrationId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: "Server error", error });
      }
    });

    // cancel registration
    app.post("/event-registrations/:id/cancel", async (req, res) => {
      const id = req.params.id;
      const result = await registrationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "cancelled" } }
      );
      res.send({
        message: "Registration cancelled",
        result,
      });
    });

    // get user registration
    app.get("/event-registrations/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await registrationsCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });
    // get all registration for an event
    app.get("/event-registrations/event/:eventId", async (req, res) => {
      const result = await registrationsCollection
        .find({ eventId: req.params.eventId })
        .toArray();
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
