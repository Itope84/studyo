September 29, 2026

# Building a post-quantum certificate authority with Merkle Tree Certificates



[Mari Galicer](/author/mari/)

13 minute read

![](S1-assets/fig1.png)When you type in an address into a browser, how do you know you’re connecting to the right website? The Web Public Key Infrastructure (Web PKI) is the complex and distributed ecosystem of policies, protocols, and infrastructure operators that helps you trust that you’re not being misdirected to an incorrect or malicious website. In the past few decades, this ecosystem has undergone significant changes. One is the addition of transparency: the now-mandatory requirement that all certificates be logged in public certificate transparency logs. Now it faces another challenge: the imminent arrival of a quantum computer, which has prompted us to upgrade to post-quantum (PQ) cryptography [by 2029](https://blog.cloudflare.com/post-quantum-roadmap/).

This transition is not straightforward: simply swapping post-quantum cryptography into certificates at Internet scale would lead to unacceptable performance degradation. This moment calls for a new approach to the Web PKI, one that allows us to treat transparency as a first-party property rather than an add-on, and design a new system that scales post-quantum signatures efficiently.

After gaining broad support across the industry, [Merkle Tree Certificates](https://datatracker.ietf.org/doc/draft-ietf-plants-merkle-tree-certs/) (MTCs) have emerged as the path forward. This year, after a successful experimental [deployment with Chrome](https://blog.cloudflare.com/bootstrap-mtc/), Cloudflare is full steam ahead on MTCs.

Following today’s announcement that Cloudflare is becoming a [certificate authority (CA)](http://blog.cloudflare.com/cloudflare-certificate-authority), we’re excited to share that this CA will support MTC issuance, targeting early 2027 for inclusion in Chrome’s newly launched [Quantum-resistant Root Store](https://googlechrome.github.io/chromerootprogram/index.html). As part of our mission to help build a better Internet, and following in Cloudflare tradition of offering the strongest available cryptography [for free](https://blog.cloudflare.com/post-quantum-crypto-should-be-free/), we will provide standard MTC issuance at no cost. Having a CA that supports both classical certificate and MTC issuance allows us to default to the most secure authentication method available, providing a painless and performant PQ upgrade path for a large swath of the Internet.

## The current trust ecosystem

To understand how MTCs are changing the game, let's start with some background on how trust works on the web today.

On the client side, browsers — in this case, “TLS clients” — maintain root programs, which specify a set of policies that CAs must follow to be trusted. On the server side, CAs are the trusted gatekeepers: they operate certificate issuance infrastructure where they validate domain ownership and attest to the binding of a domain name and a public key that shows ownership of that domain.

![](S1-assets/fig2.png)

But how do we check that CAs are following the rules? Enter certificate transparency (CT), which makes certificate issuance publicly auditable. When a CA issues a certificate, it must also submit that certificate to at least two public logs. Cloudflare has operated the [Nimbus](https://blog.cloudflare.com/introducing-certificate-transparency-and-nimbus/) family of CT logs since 2016, and is launching Raio, a new family of [static CT logs](https://blog.cloudflare.com/azul-certificate-transparency-log/), going forward.

While the CT ecosystem makes certificates publicly viewable, it doesn't mean they are correctly issued or safe to use. Monitoring helps with this by comparing those log records with what domain owners expected and reporting suspicious activity. Cloudflare launched [Certificate Transparency Monitoring](https://blog.cloudflare.com/introducing-certificate-transparency-monitoring/) in 2019 and recently made it [generally available](https://blog.cloudflare.com/certificate-transparency-monitoring-ga/). We also publish large-scale measurements about certificates on the [Certificate Transparency](https://radar.cloudflare.com/certificate-transparency) page in Radar (formerly known as Merkle Town).

As organizations begin upgrading their servers to use PQ authentication, certificate transparency monitoring will take on an even more important role in detecting potential post-quantum downgrades. Domain owners who have upgraded their domains to post-quantum authentication should monitor CT logs for unexpectedly issued legacy certificates to prevent clients from falling back on a malicious downgrade path.

Part of the problem with this current system is that transparency was an add-on, causing it to run into scaling issues. Certificates are frequently logged multiple times, in different forms, across multiple logs, requiring monitors to download and process every log to avoid missing an issuance. This can be expensive — making it difficult to encourage a diverse set of log operators at Internet scale. According to our estimates, PQ signatures will balloon the amount of data that CT logs need to store by 40x. This scaling challenge, and subsequent incentive misalignment, is at the heart of the post-quantum scaling problem.

## The post-quantum scaling problem

We've written extensively about the [challenges of scaling post-quantum cryptography](https://blog.cloudflare.com/bootstrap-mtc/), but in short: to support server authentication at Internet scale, the WebPKI must authenticate roughly a billion TLS servers without preloading every server’s public key into every client. Traditionally, CAs addressed this problem by using certificate chains as a trust-distribution mechanism. But over time, additions like key revocation checks and certificate transparency have added more public keys and signatures — five signatures and two keys in a typical TLS handshake. PQ signatures are roughly 40 times larger than classical ones, creating larger overheads that would be expensive for clients, CAs, logs, and monitors to handle at scale.

Enter [Merkle Tree Certificates](https://datatracker.ietf.org/doc/draft-ietf-transcert-merkle-tree-certs) (MTCs), a draft specification from the [IETF PLANTS](https://datatracker.ietf.org/group/plants/about/) working group that describes an architecture for compact, efficient, post-quantum certificates. MTCs batch certificates into an append-only Merkle tree, allowing a CA to sign the root of that tree instead of many individual certificates. This allows browsers or other clients to verify a certificate using a compact inclusion proof — a sequence of cryptographic hashes — against a signed tree head rather than validating each certificate individually. A [key idea](https://datatracker.ietf.org/meeting/124/materials/slides-124-plants-solution-space-and-dispatched-work-00) behind MTCs is "don't log what you issue, issue by logging." By coupling issuance and logging, transparency becomes a requirement for operation, rather than an add-on.

## The role of a certificate authority in a redesigned PKI

We’re building out our capability to issue MTCs as an integral part of our creation of a Cloudflare CA. That means keeping track of new PQ Root Program requirements, and writing an issuance and mirroring software stack at the same time we’re building the facilities, operations, and compliance functions of the traditional  CA — no small feat!

The upside is that we get to prioritize the requirements and architecture for this new, post-quantum PKI from day one, building our setup in a way that feels right for Cloudflare's values and global network — aiming to be as transparent as possible as we embark on this new journey.

Let’s take a look at the architecture updated for MTC:

![](S1-assets/fig3.png)

If you compare this to the traditional CA ecosystem, you'll notice that the responsibilities of a CA stay mostly the same: to validate control of a domain, bind it to a public key, and issue certificates. The main difference is that in the MTC ecosystem, instead of signing certificates directly and then logging them, the CA now maintains a transparency log backed by a Merkle tree, where an inclusion proof that the certificate is indeed in the tree serves as the trust anchor. CAs will also operate *Mirroring cosigners* that store a copy of issuance logs, verifying their append-only consistency and ensuring the transparency and availability of these logs for the broader ecosystem.

### Issuing MTCs

MTCs come in two forms, both of which can be encoded in the X.509 certificate format that client software recognizes today — just with a “funny” signature algorithm. In *standalone* form, the certificate’s signature value contains a cosigned tree head of an issuance log and an inclusion proof (a sequence of hashes) demonstrating that the certificate is contained in that log. If clients are able to obtain the cosigned tree heads out of band (e.g., via a browser update mechanism), the certificate can instead be served in *landmark-relative* form, where the signature value consists of the lightweight inclusion proof with no heavyweight post-quantum signatures at all.

For simplicity’s sake, let’s take a look at an example of standalone certificate issuance. When a website wants a certificate for their domain, they can request it from a CA via the Automatic Certificate Management Environment (ACME) protocol, which handles certificate requests, domain-control validation, and issuance workflows. Cloudflare's ACME infrastructure will be a fork of [Boulder](https://github.com/letsencrypt/boulder), the widely deployed and well-tested ACME software that powers Let's Encrypt. Let's Encrypt is actively developing [MTC support](https://letsencrypt.org/2026/06/03/pq-certs) in Boulder, and we plan to maintain our own fork that incorporates these upstream changes along with Cloudflare-specific modifications, contributing back upstream where possible.

When the MTC CA receives a certificate issuance request, the CA's ACME server checks that the server actually controls the domain. If those checks pass, the CA serializes that data and adds it to an append-only log.

![](S1-assets/fig4.png)

After adding the MTC entry into its issuance log, the CA computes the updated state of the log, and then signs a checkpoint over that state. This checkpoint attests that the CA issued every entry included in the log’s Merkle tree up until that point in time.

The CA then sends its updated log state and new checkpoint to a trusted cosigner, which durably stores a copy of the CA's issuance log and checks that each new state is append-only, consistent with the previous tree, and correctly formed. This additional cosignature gives clients and monitors confidence that another trusted party has observed the same log state and verified that the CA is not presenting different views of issuance to different parts of the ecosystem. It also ensures that the issued certificates will be available for monitoring even if the CA issuance log is unavailable.

![](S1-assets/fig5.png)

Chrome’s [Quantum-resistant Root Program draft policy](https://googlechrome.github.io/chromerootprogram/cqrp/draft-policy/) mandates at least two cosignatures: one from a Chrome-recognized Mirroring Cosigner operated by a distinct organization, and one from the issuing MTC CA itself. As such, we'll operate mirrors for other pilot CAs — and require at least one independent cosignature on our own issued certificates.

Cloudflare will implement our mirroring cosigner in [Azul](https://github.com/cloudflare/azul), our open-source Rust-based transparency log, and for maximal interoperability, it will implement [c2sp's tlog mirror](http://c2sp.org/tlog-mirror) protocol.

Finally, after successfully receiving a cosignature from a mirroring cosigner, the CA constructs an MTC with the cosignatures, server's public key, and an inclusion proof. It then sends that MTC to the server, which can then use it for TLS moving forward!

![](S1-assets/fig6.png)

### Delivering PQ signatures efficiently: the landmark optimization

While standalone certificates are functional, they still send large PQ signatures over the TLS handshake, limiting their efficiency. The real performance improvements provided by the MTC design are landmark-relative certificates.

Instead of sending cosignatures in every certificate, CAs can designate a sequence of subtrees that cover all active certificates in the log as a landmark, and distribute those subtrees (along with data to authenticate them) to clients via an out-of-band update service. During a TLS handshake, the actual authentication to the server happens by the browser checking that the server's certificate data — including its domain name and public key — appears in a trusted subtree of the CA’s log. If the inclusion proof connects that certificate to a cosigned landmark, and the public key then proves possession during the TLS handshake, the client knows it is talking to the right server.

![](S1-assets/fig7.png)

Periodically transmitting these signatures and tree metadata to TLS clients out of band, a small set of MTC batch signatures can efficiently cover billions of certificates issued by a given CA. While landmarks are more efficient at scale, they do not eliminate the need for standalone MTCs — clients may be newly installed, offline, or missing the relevant landmark update. That’s why it’s important that servers retain a standalone certificate fallback.

## MTCs in the wild: results of our experiment with Chrome

This year, we ran an experiment with Chrome to test the feasibility of MTCs between a client and server. We operated a "bootstrap CA" (a fake CA that stubbed the issuance pipeline) that issued MTCs backed by a traditional certificate chain for a selection of Cloudflare domains on Cloudflare's "free" plan and served them to 50% of Chrome Beta 146. Over the course of the experiment we successfully served billions of MTCs.

For TLS, we found that the common case is fairly efficient: with a landmark-relative certificate, the handshake only needs to transmit one public key, one signature, and one inclusion proof of less than 1kB. In the experiment, we fell back to the traditional certificate chain instead of serving a standalone certificate in cases where we were unable to negotiate a landmark-relative certificate with the client. On the CT side, MTCs also change the scaling properties of transparency: the log only needs to carry hashes of public keys; there are no per-entry signatures, and the signature on the tree head covers the whole log. This prevents certificate explosion because the CA issuance log is the source of truth for all certificates the CA issues, and log consumers only need to fetch a single copy of each certificate.

![](S1-assets/fig8.png)

The result: MTCs really work! At median, using a MTC is 9% faster using landmark MTCs over a classical signature chain (admittedly, most of this performance benefit is due to intermediate elision). And because we tested MTCs with classical signatures, we expect an even greater improvement with post-quantum signatures. Satisfied with these results, and with the level of cross-industry collaboration with MTCs at the [PLANTS WG](https://datatracker.ietf.org/wg/plants/documents/) at the IETF, we began winding down the experiment last month (August 2026).

## The road ahead for MTCs

We’re excited that our experiment with Chrome showed that MTCs can work in practice, and are especially excited to be able to issue certificates as a real CA.

However, there are still broader questions that we can only answer by running this great experiment with the full PKI ecosystem. Can independent monitors [consume and verify](https://transparency.dev/summit2025/talks/verifiable-indexes.html) MTC issuance logs at production volume? Will multiple CAs and cosigners emerge so that the system has the diversity needed for resilience? How should browsers balance the performance benefits of compact landmark MTCs with the fallback paths needed for clients without fresh landmarks? MTCs have emerged as the authoritative design for post-quantum authentication, but proving it out at production Internet scale will require participation from a diverse set of root programs, browser vendors, CAs, mirrors, monitors, and the wider community.

We see the opportunity to participate in this next phase of the Web PKI as an honor, and we take the responsibility of operating CA infrastructure seriously. CAs occupy a privileged position in the trust ecosystem — browsers, domain owners, and everyday people rely on them to validate identities correctly, protect signing keys, follow policy, and operate reliably. Before Cloudflare's CA can be trusted by browsers to issue MTCs, we will need to apply to Chrome's Quantum Resistant root store and undergo a rigorous evaluation process. We welcome that scrutiny, and we expect to hold ourselves to the same high bar as any other CA trusted with helping secure the Internet. We hope other CAs will emerge to support MTC adoption, and we're excited to work with any browser that wants to deploy MTCs.

