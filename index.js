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





        app.get('/api/books', async (req, res) => {
            try {
                const {
                    search = "",
                    category,
                    sort
                } = req.query;

                const query = {
                    approvalStatus: { $in: ["approved", "pending"] }
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

        // app.get('/api/books/:email', async (req, res) => {
        //     const { email } = req.params;
        //     const result = await bookCollection.find({ userEmail: email }).toArray();
        //     res.send(result);
        // })


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