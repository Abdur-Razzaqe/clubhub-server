const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./club-hub-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded", decoded);
    req.decoded_email = decoded.email;
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

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

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };
    const verifyManager = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user.role !== "manager") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // user api
    app.post("/users", verifyFBToken, async (req, res) => {
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
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    // user role api
    app.get("/users/role/:email", verifyFBToken, async (req, res) => {
      const user = await userCollection.findOne({ email: req.params.email });
      if (!user) {
        return res.status(404).send({ role: null });
      }
      res.send({ role: user.role });
    });

    app.get("/admin/users", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // update user role api
    app.patch(
      "/users/role/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send(result);
      }
    );

    // clubs api
    app.get("/clubs", async (req, res) => {
      const result = await clubsCollection.find().toArray();
      console.log("from DB", result);
      res.send(result);
    });

    app.get("/admin/clubs", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await clubsCollection.find().toArray();
      res.send(result);
    });

    app.get(
      "/manager/clubs",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const email = req.query.email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
        const result = await clubsCollection
          .find({ managerEmail: email })
          .toArray();
        res.send(result);
      }
    );

    // club details api
    app.get("/clubs/:id", async (req, res) => {
      const id = req.params.id;
      const result = await clubsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // update club api
    app.put("/clubs/:id", verifyFBToken, verifyManager, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const result = await clubsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );
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

    app.post("/clubs", verifyFBToken, verifyManager, async (req, res) => {
      const club = req.body;

      const newClub = {
        managerEmail: req.decoded_email,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await clubsCollection.insertOne(newClub);
      res.send(result);
    });

    // all upcoming events
    app.get("/events", verifyFBToken, async (req, res) => {
      const managerEmail = req.decoded_email;
      const result = await eventsCollection
        .find({ managerEmail })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });
    app.get(
      "/manager/my-events",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const managerEmail = req.decoded_email;
        const result = await eventsCollection
          .find({ managerEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      }
    );

    app.get("/events/:id", async (req, res) => {
      const eventId = req.params.id;
      const result = await eventsCollection.findOne({
        _id: new ObjectId(eventId),
      });

      res.send(result);
    });

    // create event api
    app.post(
      "/manager/events",
      verifyFBToken,
      verifyManager,

      async (req, res) => {
        const event = req.body;
        const managerEmail = req.decoded_email;
        const club = await clubsCollection.findOne({
          _id: new ObjectId(event.clubId, managerEmail),
          managerEmail,
        });

        if (!club) {
          return res
            .status(404)
            .send({ message: "Club not found for this manager" });
        }

        const newEvent = {
          ...event,
          clubId: club._id.toString(),
          managerEmail,
          createdAt: new Date(),
        };

        const result = await eventsCollection.insertOne(newEvent);
        res.send(result);
      }
    );

    // event register api
    app.post("/event-registrations", async (req, res) => {
      try {
        const { eventId, userEmail } = req.body;

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
          eventId,
          userEmail,
          clubId: event.clubId,
          status: "registered",
          paymentId: paymentId || null,
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
    app.get(
      "/events/:eventId/registrations",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const { eventId } = req.params;
        const event = await eventsCollection.findOne({
          _id: new ObjectId(eventId),
        });
        if (!event) return res.status(404).send({ message: "Event not found" });

        if (event.managerEmail !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const result = await registrationsCollection
          .find({ eventId })
          .toArray();
        res.send(result);
      }
    );

    app.get("/admin/stats", async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const totalEvents = await eventsCollection.countDocuments();
        const totalClubs = await clubsCollection.countDocuments();
        const pendingClubs = await clubsCollection.countDocuments({
          status: "pending",
        });
        const approvedClubs = await clubsCollection.countDocuments({
          status: "approved",
        });
        const rejectedClubs = await clubsCollection.countDocuments({
          status: "rejected",
        });
        const totalMemberships = await registrationsCollection.countDocuments({
          status: "registered",
        });
        res.send({
          totalUsers,
          totalClubs,
          pendingClubs,
          approvedClubs,
          rejectedClubs,
          totalEvents,
          totalMemberships,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load admin stats" });
      }
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const amount = paymentInfo.amount * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price: {
              currency: "USD",
              unit_amount: amount,
              product_date: {
                name: paymentInfo.clubName,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.memberEmail,
        mode: "payment",
        metadata: {
          clubId: paymentInfo.clubId,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      console.log(session);
      res.send({ url: session.url });
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
