const express = require('express');
const dotenv = require("dotenv")
const cors = require("cors")
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config()
const app = express();
const port = process.env.PORT;

app.use(cors());
app.use(express.json())


const uri = process.env.MONGO_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });

        const db = client.db("booksphere")
        const bookCollection = db.collection("books")
        const deliveriesCollection = db.collection("deliveries")
        const reviewCollection = db.collection("reviews")
        const paymentCollection = db.collection("payments")
        const usersCollection = db.collection("user");





        app.get('/api/books', async (req, res) => {
            try {
                const {
                    search = "",
                    category,
                    sort
                } = req.query;

                const query = {
                    approvalStatus: { $in: ["approved"] }
                };

                // Search by title or author
                if (search) {
                    query.$or = [
                        {
                            title: {
                                $regex: search,
                                $options: "i"
                            }
                        },
                        {
                            author: {
                                $regex: search,
                                $options: "i"
                            }
                        }
                    ];
                }

                // Category filter
                if (category && category !== "all") {
                    query.category = category;
                }

                let sortOption = {};

                switch (sort) {
                    case "title":
                        sortOption = { title: 1 };
                        break;

                    case "fee-low":
                        sortOption = { deliveryFee: 1 };
                        break;

                    case "fee-high":
                        sortOption = { deliveryFee: -1 };
                        break;

                    case "newest":
                        sortOption = { createdAt: -1 };
                        break;

                    default:
                        sortOption = {};
                }

                const result = await bookCollection
                    .find(query)
                    .sort(sortOption)
                    .toArray();

                res.send(result);

            } catch (error) {
                console.error(error);
                res.status(500).send({
                    message: "Failed to fetch books"
                });
            }
        });

        app.get('/api/single-book/:id', async (req, res) => {
            const { id } = req.params;
            const query = { _id: new ObjectId(id) };
            const result = await bookCollection.findOne(query)
            res.send(result)
        })

        app.get('/api/books/:email', async (req, res) => {
            const { email } = req.params;
            const result = await bookCollection.find({ librarianEmail: email }).toArray();
            res.send(result);
        })

        app.post('/api/books', async (req, res) => {
            const data = req.body;

            const result = await bookCollection.insertOne({
                ...data,
                approvalStatus: "pending",
                createdAt: new Date()
            });

            res.send(result);
        });

        app.patch('/api/books/:id', async (req, res) => {
            const { id } = req.params;

            const updatedData = req.body;
            const result = await bookCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        ...updatedData
                    }
                }
            )
            res.send(result)
        })

        app.delete('/api/books/:id', async (req, res) => {
            const { id } = req.params;
            const result = await bookCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        app.get("/api/librarian-stats/:email", async (req, res) => {
            try {
                const { email } = req.params;

                // All books added by this librarian
                const books = await bookCollection
                    .find({ librarianEmail: email })
                    .toArray();

                const totalBooks = books.length;

                // Get all book ids
                const bookIds = books.map(book => book._id.toString());

                // All deliveries related to those books
                const deliveries = await deliveriesCollection
                    .find({
                        bookId: { $in: bookIds }
                    })
                    .toArray();

                // Pending requests
                const pendingRequests = deliveries.filter(
                    delivery => delivery.deliveryStatus === "Pending"
                ).length;

                // Total earnings
                const totalEarnings = deliveries.reduce(
                    (total, delivery) =>
                        total + Number(delivery.amount || 0),
                    0
                );

                // Most requested books
                const popularBooks = books
                    .sort(
                        (a, b) =>
                            (b.requestCount || 0) -
                            (a.requestCount || 0)
                    )
                    .slice(0, 5)
                    .map(book => ({
                        title: book.title,
                        requests: book.requestCount || 0,
                    }));

                // Earnings chart
                const monthlyEarnings = {};

                deliveries.forEach((delivery) => {
                    const date = new Date(
                        delivery.requestedAt || delivery.createdAt
                    );

                    const month = date.toLocaleString("default", {
                        month: "short",
                    });

                    if (!monthlyEarnings[month]) {
                        monthlyEarnings[month] = 0;
                    }

                    monthlyEarnings[month] += Number(
                        delivery.amount || 0
                    );
                });

                const earningsChart = Object.entries(
                    monthlyEarnings
                ).map(([month, earnings]) => ({
                    month,
                    earnings,
                }));

                res.send({
                    totalBooks,
                    totalEarnings,
                    pendingRequests,
                    popularBooks,
                    earningsChart,
                });
            } catch (error) {
                console.error(error);

                res.status(500).send({
                    message: "Failed to load dashboard stats",
                });
            }
        });

        app.post('/api/books/delivery', async (req, res) => {
            const {
                bookId,
                bookTitle,
                quantity,
                email,
                amount,
                paymentType,
                transactionId,
                paymentStatus,
            } = req.body;

            const existingPayment = await paymentCollection.findOne({
                transactionId,
            });

            if (existingPayment) {
                return res.status(200).send({
                    message: "Already processed",
                });
            }
            const deliveryData = {
                bookId,
                bookTitle,
                readerEmail: email,
                quantity,
                amount,
                transactionId,
                paymentStatus,
                deliveryStatus: "Pending",
                requestedAt: new Date(),
            };

            console.log('deliveryData', deliveryData);

            const deliveryResult =
                await deliveriesCollection.insertOne(deliveryData);

            await bookCollection.updateOne(
                { _id: new ObjectId(bookId) },
                {
                    $inc: {
                        requestCount: quantity,
                    },
                }
            );

            const paymentData = {
                userEmail: email,
                amount,
                transactionId,
                paymentStatus,
                paymentType,
                bookId,
                bookTitle,
                paidAt: new Date(),
            };

            await paymentCollection.insertOne(paymentData);

            res.send(deliveryResult);
        });

        app.get("/api/books/deliveries/:email", async (req, res) => {
            const { email } = req.params;

            const result = await deliveriesCollection
                .find({
                    readerEmail: email,
                })
                .sort({
                    requestedAt: -1,
                })
                .toArray();

            res.send(result);
        });

        app.get("/api/user-stats/:email", async (req, res) => {
            try {
                const { email } = req.params;

                const deliveries = await deliveriesCollection
                    .find({
                        readerEmail: email,
                    })
                    .toArray();

                const totalBooksRead = deliveries.reduce(
                    (sum, item) => sum + Number(item.quantity || 0),
                    0
                );

                const pendingDeliveries = deliveries.filter(
                    (item) => item.deliveryStatus === "Pending"
                ).length;

                const totalSpent = deliveries.reduce(
                    (sum, item) => sum + Number(item.amount || 0),
                    0
                );

                const chartData = [
                    {
                        metric: "Books",
                        value: totalBooksRead,
                    },
                    {
                        metric: "Pending",
                        value: pendingDeliveries,
                    },
                    {
                        metric: "Spent",
                        value: totalSpent,
                    },
                ];

                const recentDeliveries = deliveries
                    .sort(
                        (a, b) =>
                            new Date(b.requestedAt) -
                            new Date(a.requestedAt)
                    )
                    .slice(0, 5);

                res.send({
                    totalBooksRead,
                    pendingDeliveries,
                    totalSpent,
                    chartData,
                    recentDeliveries,
                });
            } catch (error) {
                res.status(500).send({
                    message: "Failed to load user dashboard.",
                });
            }
        });

        app.get("/api/admin/pending-books", async (req, res) => {
            try {
                const books = await bookCollection
                    .find({
                        approvalStatus: "pending",
                    })
                    .sort({
                        createdAt: -1,
                    })
                    .toArray();

                res.send(books);
            } catch (err) {
                res.status(500).send({
                    message: "Failed to fetch pending books.",
                });
            }
        });


        app.get('/api/admin/books', async (req, res) => {
            try {
                const { status } = req.query;

                const query = {};

                if (status && status !== "all") {
                    query.approvalStatus = status;
                }

                const result = await bookCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to fetch books" });
            }
        });

        app.patch('/api/admin/books/:id', async (req, res) => {
            const id = req.params.id;
            const updatedBooks = req.body;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    approvalStatus: "approved",
                    publishStatus: "published",
                },
            };
            const result = await bookCollection.updateOne(filter, updatedDoc);
            res.send(result)
        });

        app.patch("/api/admin/books/:id/publish", async (req, res) => {
            try {
                const { id } = req.params;

                const book = await bookCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!book) {
                    return res.status(404).send({
                        message: "Book not found.",
                    });
                }

                const newStatus =
                    book.publishStatus === "published"
                        ? "unpublished"
                        : "published";

                await bookCollection.updateOne(
                    {
                        _id: new ObjectId(id),
                    },
                    {
                        $set: {
                            publishStatus: newStatus,
                        },
                    }
                );

                res.send({
                    success: true,
                    publishStatus: newStatus,
                });
            } catch (err) {
                res.status(500).send({
                    message: "Failed to update publish status.",
                });
            }
        });

        app.get("/api/admin/users", async (req, res) => {
            try {
                const users = await usersCollection
                    .find({
                        role: { $ne: "admin" }, // Exclude admins
                    })
                    .sort({ name: 1 })
                    .toArray();

                res.send(users);
            } catch (err) {
                res.status(500).send({
                    message: "Failed to fetch users",
                });
            }
        });

        app.patch("/api/admin/users/:id/role", async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body;

                await usersCollection.updateOne(
                    {
                        _id: new ObjectId(id),
                    },
                    {
                        $set: {
                            role,
                        },
                    }
                );

                res.send({
                    success: true,
                });
            } catch (err) {
                res.status(500).send({
                    message: "Failed to update role",
                });
            }
        });

        app.delete("/api/admin/users/:id", async (req, res) => {
            try {
                const { id } = req.params;

                await usersCollection.deleteOne({
                    _id: new ObjectId(id),
                });

                res.send({
                    success: true,
                });
            } catch (err) {
                res.status(500).send({
                    message: "Failed to delete user",
                });
            }
        });

        app.get("/api/admin/transactions", async (req, res) => {
            try {
                const payments = await paymentCollection
                    .find()
                    .sort({ paidAt: -1 })
                    .toArray();

                const transactions = await Promise.all(
                    payments.map(async (payment) => {
                        const book = await bookCollection.findOne({
                            _id: new ObjectId(payment.bookId),
                        });

                        return {
                            _id: payment._id,
                            transactionId: payment.transactionId,
                            userEmail: payment.userEmail,
                            librarianEmail:
                                book?.librarianEmail || "N/A",
                            amount: payment.amount,
                            paidAt: payment.paidAt,
                        };
                    })
                );

                res.send(transactions);
            } catch (err) {
                console.error(err);

                res.status(500).send({
                    message: "Failed to fetch transactions",
                });
            }
        });

        app.get("/api/admin/dashboard", async (req, res) => {
            try {
                const totalUsers = await usersCollection.countDocuments({
                    role: { $ne: "admin" },
                });

                const totalBooks = await bookCollection.countDocuments();

                const totalDeliveries =
                    await deliveriesCollection.countDocuments();

                const payments = await paymentCollection.find().toArray();

                const totalRevenue = payments.reduce(
                    (sum, item) => sum + Number(item.amount || 0),
                    0
                );

                const categoryStats = await bookCollection
                    .aggregate([
                        {
                            $group: {
                                _id: "$category",
                                value: { $sum: 1 },
                            },
                        },
                    ])
                    .toArray();

                const booksByCategory = categoryStats.map((item) => ({
                    category: item._id,
                    value: item.value,
                }));

                res.send({
                    totalUsers,
                    totalBooks,
                    totalDeliveries,
                    totalRevenue,
                    booksByCategory,
                });
            } catch (err) {
                console.error(err);

                res.status(500).send({
                    message: "Failed to load dashboard",
                });
            }
        });


        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});