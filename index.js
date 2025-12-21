const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.BF_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

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
    const membershipsCollection = db.collection("memberships");
    const paymentsCollection = db.collection("payments");

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
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    // user role api
    app.get("/users/role/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const user = await userCollection.findOne({ email });

      res.send({ role: user?.role || null });
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
        if (!role) {
          return res.status(400).send({ message: "Role is required" });
        }
        const result = await userCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );
        res.send(result);
      }
    );

    // clubs api
    app.get("/clubs", async (req, res) => {
      const result = await clubsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    app.get("/admin/clubs", verifyFBToken, verifyAdmin, async (req, res) => {
      const result = await clubsCollection.find().toArray();
      res.send(result);
    });

    // club status api
    app.patch(
      "/admin/clubs/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        const result = await clubsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send(result);
      }
    );

    app.get(
      "/manager/clubs",
      verifyFBToken,

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

    // manager club-member
    app.get(
      "/manager/club-members",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;
          const clubs = await clubsCollection.find({ managerEmail }).toArray();

          const clubIds = clubs.map((club) => club._id.toString());
          const members = await membershipsCollection
            .find({ clubId: { $in: clubIds } })
            .sort({ joinedAt: -1 })
            .toArray();

          res.send({
            clubs,
            members,
          });
        } catch (error) {
          console.error("Manager club members error:", error);
          res.status(500).send({ message: "Failed to load club members" });
        }
      }
    );

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
      const clubData = req.body;

      const newClub = {
        ...clubData,
        managerEmail: req.decoded_email,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await clubsCollection.insertOne(newClub);
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
      "/manager/my-events",
      verifyFBToken,
      verifyManager,

      async (req, res) => {
        const event = req.body;

        const managerEmail = req.decoded_email;
        const club = await clubsCollection.findOne({
          managerEmail: managerEmail,
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
    // event update api
    app.put(
      "/manager/my-events/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const { id } = req.params;
          const managerEmail = req.decoded_email;
          const updateData = req.body;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid event id" });
          }
          const event = await eventsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!event) {
            return res.status(404).send({ message: "event not found" });
          }
          if (event.managerEmail !== managerEmail) {
            return res.status(403).send({ message: "Forbidden access" });
          }
          const result = await eventsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                title: updateData.title,
                description: updateData.description,
                eventDate: updateData.eventDate,
                location: updateData.location,
                isPaid: updateData.isPaid,
                eventFee: parseFloat(updateData.eventFee) || 0,
                maxAttendees: parseInt(updateData.maxAttendees) || 0,
                updatedAt: new Date(),
              },
            }
          );
          if (result.modifiedCount === 0) {
            res.status(200).send({ message: "No changes made to the event" });
          }
          res.send({
            message: "Event updated successfully",
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to update event" });
        }
      }
    );

    // event delete api
    app.delete(
      "/manager/my-events/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const { id } = req.params;
          const managerEmail = req.decoded_email;
          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid event id" });
          }

          const event = await eventsCollection.findOne({
            _id: new ObjectId(id),
          });
          if (!event) {
            return res.status(404).send({ message: "event not found" });
          }
          if (event.managerEmail !== managerEmail) {
            return res.status(403).send({
              message:
                "Forbidden access: Your are authorized to delete this event",
            });
          }
          const result = await eventsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 1) {
            res.send({
              message: "Event deleted successfully",
              deletedCount: result.deletedCount,
            });
          } else {
            res.status(400).send({ message: "Could not delete the event" });
          }
        } catch (error) {
          console.error("Delete Error", error);
          res.status(500).send({ message: "Failed to delete event" });
        }
      }
    );

    // event register api
    app.post("/event-registrations", verifyFBToken, async (req, res) => {
      try {
        const { eventId, paymentId } = req.body;
        const userEmail = req.decoded_email;

        if (!userEmail) {
          return res
            .status(401)
            .send({ message: "unauthorized email not found" });
        }
        if (!eventId) {
          return res.status(400).send({ message: "Event ID is required" });
        }
        if (!ObjectId.isValid(eventId)) {
          return res.status(400).send({ message: "Event not found" });
        }

        const event = await eventsCollection.findOne({
          _id: new ObjectId(eventId),
        });
        if (!event) return res.status(404).send({ message: "Event not found" });

        const alreadyRegistered = await registrationsCollection.findOne({
          eventId: eventId,
          userEmail: userEmail,
        });

        if (alreadyRegistered) {
          return res
            .status(400)
            .send({ message: "Already registered for this event" });
        }

        const registration = {
          eventId: eventId,
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
        console.error("Registration Error", error);
        res.status(500).send({ message: "Server error", error: error.message });
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
      "/manager/events/:eventId/registrations",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const { eventId } = req.params;
          const managerEmail = req.decoded_email;

          const event = await eventsCollection.findOne({
            _id: new ObjectId(eventId),
          });

          if (!eventId) {
            return res.status(400).send({ message: "Invalid event Id format" });
          }

          const club = await clubsCollection.findOne({
            _id: new ObjectId(event.clubId),
            managerEmail: managerEmail,
          });

          if (!club) {
            return res.status(403).send({ message: "Forbidden access" });
          }

          const registrations = await registrationsCollection
            .find({ eventId: eventId })
            .sort({ registeredAt: -1 })
            .toArray();
          res.send(registrations);
        } catch (error) {
          console.error("Event registrations error", error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    app.get("/member/my-events", verifyFBToken, async (req, res) => {
      const userEmail = req.decoded_email;

      const registrations = await registrationsCollection
        .find({ userEmail })
        .toArray();

      const eventIds = registrations.map((r) => new ObjectId(r.eventId));

      const events = await eventsCollection
        .find({
          _id: { $in: eventIds },
        })
        .toArray();

      const clubIds = events.map((e) => new ObjectId(e.clubId));

      const clubs = await clubsCollection
        .find({ _id: { $in: clubIds } })
        .toArray();

      const result = registrations.map((reg) => {
        const event = events.find((e) => e._id.toString() === reg.eventId);

        const club = clubs.find((c) => c._id.toString() === event?.clubId);

        return {
          _id: reg._id,
          title: event?.title || "N/A",
          clubName: club?.clubName || "N/A",
          eventDate: event?.eventDate || null,
          status: reg.status,
        };
      });

      res.send(result);
    });

    // admin overview api
    app.get("/admin/overview", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const totalEvents = await eventsCollection.countDocuments();

        const totalMemberships = await membershipsCollection.countDocuments();
        const clubStats = await clubsCollection
          .aggregate([
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        const clubs = {
          pending: 0,
          approved: 0,
          rejected: 0,
        };
        clubStats.forEach((item) => {
          clubs[item._id] = item.count;
        });

        const payments = paymentsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalAmount: { $sum: "$amount" },
              },
            },
          ])
          .toArray();

        res.send({
          totalUsers,
          clubs,
          totalEvents,
          totalMemberships,
          totalPaymentAmount: payments[0]?.totalAmount || 0,
        });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to load admin overview", error });
      }
    });
    // // manager overview api
    app.get(
      "/manager/overview",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          const clubs = await clubsCollection.find({ managerEmail }).toArray();
          const clubIds = clubs.map((c) => c._id.toString());

          const totalMembers = await membershipsCollection.countDocuments({
            clubId: { $in: clubIds },
            status: "active",
          });

          const totalEvents = await eventsCollection.countDocuments({
            clubId: { $in: clubIds },
          });

          const payments = await paymentsCollection
            .find({ clubId: { $in: clubIds } })
            .toArray();

          const totalPayments = payments.reduce(
            (sum, p) => sum + Number(p.amount || 0),
            0
          );

          res.send({
            totalClubs: clubs.length,
            totalMembers,
            totalEvents,
            totalPayments,
          });
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .send({ message: "Failed to load admin overview", error });
        }
      }
    );

    // member overview api
    app.get("/member/overview/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        const userEmail = req.decoded_email;

        if (email !== userEmail) {
          res.status(403).send({ message: "forbidden access" });
        }

        const memberships = await membershipsCollection
          .find({ userEmail, status: "active" })
          .toArray();

        const clubIds = memberships.map((m) => new ObjectId(m.clubId));
        const totalClubs = memberships.length;

        const totalEvents = await registrationsCollection.countDocuments({
          userEmail,
          status: "registered",
        });
        let updateEvents = [];
        if (clubIds.length > 0) {
          upcomingEvents = await eventsCollection
            .find({ clubId: { $in: clubIds }, eventDate: { $gte: new Date() } })
            .sort({ eventDate: 1 })
            .toArray();
        }

        const clubMap = {};

        clubs.forEach((c) => {
          clubMap[c._id.toString()] = c.clubName;
        });
        const eventsWithClub = upcomingEvents.map((e) => ({
          _id: e._id,
          title: e.title,
          eventDate: e.eventDate,
          clubName: clubMap[e.clubId?.toString()] || "Unknown Club",
        }));

        const payments = await paymentsCollection
          .find({ memberEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send({
          totalClubs,
          totalEvents,
          upcomingEvents: eventsWithClub,
          memberships,
          payments,
        });
      } catch (error) {
        console.error("member overview error", error);
        res.status(500).send({ message: "Failed to load member overview" });
      }
    });
    // membership bar chart api
    app.get(
      "/admin/memberships-per-club",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const result = await membershipsCollection
          .aggregate([
            {
              $group: {
                _id: "$clubId",
                totalMembers: { $sum: 1 },
              },
            },
            {
              $lookup: {
                from: "clubs",
                localField: "_id",
                foreignField: "_id",
                as: "club",
              },
            },
            {
              $unwind: "$club",
            },
            {
              $project: {
                _id: 0,
                clubName: "$club.clubName",
                totalMembers: 1,
              },
            },
          ])
          .toArray();
        res.send(result);
      }
    );

    // member api
    app.get("/member/my-clubs", verifyFBToken, async (req, res) => {
      try {
        const email = req.decoded_email;
        const memberships = await membershipsCollection
          .find({ userEmail: email, status: "active" })
          .toArray();

        const clubIds = memberships.map((m) => new ObjectId(m.clubId));

        const clubs = await clubsCollection
          .find({ _id: { $in: clubIds } })
          .toArray();

        const result = memberships.map((m) => {
          const club = clubs.find((c) => c._id.toString() === m.clubId);

          return {
            clubId: m.clubId,
            clubName: club?.clubName,
            location: club?.location,
            status: m.status,
            expiresAt: m.expiresAt || "Lifetime",
          };
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to load my clubs" });
      }
    });

    app.get(
      "/manager/club-members",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.decoded_email;

          const clubs = await clubsCollection.find({ managerEmail }).toArray();
          const clubIds = clubs.map((c) => c._id);

          const members = await membershipsCollection
            .find({ clubId: { $in: clubIds } })
            .toArray();
          res.send({ members, clubs });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to fetch club members" });
        }
      }
    );
    // set membership as expired
    app.patch(
      "/manager/memberships/:id/expire",
      verifyFBToken,

      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await membershipsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "expired" } }
          );
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Failed to expire membership" });
        }
      }
    );

    // payment related apis
    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const paymentInfo = req.body;
        const { amount, clubName, memberEmail, clubId } = paymentInfo;

        if (!amount || !clubName || !memberEmail || !clubId)
          return res.status(400).send({ message: "Invalid payment data" });

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "USD",
                unit_amount: Number(amount) * 100,
                product_data: {
                  name: clubName,
                },
              },

              quantity: 1,
            },
          ],
          customer_email: memberEmail,
          mode: "payment",
          metadata: {
            clubId,
            clubName,
            memberEmail,
            amount,
            type: "membership",
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?clubsId=${paymentInfo.clubId}&amount=${paymentInfo.amount}&clubName=${paymentInfo.clubName}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Stripe error:", error);
        res.status(500).send({ message: "Stripe session failed" });
      }
    });
    // payment success api
    app.post("/payments/success", verifyFBToken, async (req, res) => {
      try {
        const { clubId, userEmail } = req.body;
        const club = await clubsCollection.findOne({
          _id: new ObjectId(clubId),
        });
        if (!club) {
          return res.status(404).send({ message: "Club not found" });
        }
        const paymentData = {
          userEmail: userEmail || req.decoded_email,
          clubId: clubId,
          clubName: club.clubName,
          amount: club.membershipFee,
          type: "membership",
          status: "paid",
          createdAt: new Date(),
        };

        const result = await paymentsCollection.insertOne(paymentData);

        res.send({
          message: "Payment confirmed",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("payment API error", err);
        res.status(500).send({ message: "Failed to save payment" });
      }
    });

    //     if (!clubId || !amount) {
    //       res.status(400).send({ message: "Invalid payment data" });
    //     }

    //     const existing = await membershipsCollection.findOne({
    //       clubId,
    //       userEmail,
    //     });
    //     if (!existing) {
    //       await membershipsCollection.insertOne({
    //         clubId,
    //         userEmail,
    //         status: "active",
    //         paymentStatus: "paid",
    //         joinedAt: new Date(),
    //       });
    //     }
    //     const paymentRecord = {
    //       clubId,
    //       clubName,
    //       userEmail,
    //       amount,
    //       type,
    //       status: "paid",
    //       createdAt: new Date(),
    //     };
    //     await paymentsCollection.insertOne(paymentRecord);

    //     res.send({ success: true, message: "Payment recorded successfully" });
    //   } catch (error) {
    //     console.error(error);
    //     res.status(500).send({ message: "Payment recording failed" });
    //   }
    // });

    app.get("/admin/payments", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const result = await paymentsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch payment" });
      }
    });

    // manager payment api
    app.get(
      "/manager/payments",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const managerEmail = req.body;

          const clubs = await clubsCollection.find({ managerEmail }).toArray();
          const clubIds = clubs.map((c) => c._id);

          const payments = paymentsCollection
            .find({ clubId: { $in: clubIds } })
            .sort({ createdAt: -1 })
            .toArray();

          const totalPayments = (await payments).reduce(
            (sum, p) => sum + (p.amount || 0),
            0
          );
          res.send({ totalPayments, payments });
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Failed to fetch manager payments" });
        }
      }
    );

    // member payments api
    app.get("/member/payments", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        const payments = await paymentsCollection
          .find({ userEmail })
          .sort({ createdAt: -1 })
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error(error);
        res.status(500).send([]);
      }
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
