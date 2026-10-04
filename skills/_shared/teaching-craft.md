# Teaching craft

Moves that good technical teachers use, for skills that teach (`condense`, and the in-depth guide). These are moves, not a voice: never imitate anyone's phrasing, catchphrases or personality. Pick a move only when this idea needs it. Facts still come from the pack (`grounding-and-citations.md`); a move changes how a fact is taught, not which facts are stated.

Sources of the moves (not for the learner's output): the Rust Book authors, Julia Evans, Martin Kleppmann, Jay Alammar, Jeffrey Way, Wes Bos, the Laravel docs, 3Blue1Brown, Richard Feynman, Steven Strogatz. Do not name them in a document.

## How to use this file

Match moves to the kind of material, then to the learner's goal.
- **Code and tools:** build it, run it, break it.
- **Systems:** follow one request, then break a part.
- **Math and science:** the puzzle, the picture, the plain sentence.
- **Any kind:** the moves under "Everywhere".

A move's example below is an illustration of the shape. Do not reuse it in a document.

## Everywhere

**Say what changes for the reader.** Open a part with what the reader will be able to do or see after it, in one sentence. Not a roadmap of headings.

**Concrete before general.** Show one small case, then say what it was an instance of. If you catch yourself stating the rule first, move the case up.

**Name the wrong picture.** When there is a common wrong mental model, state it, say why it is tempting, then correct it. Skip this where there is none.

**Smallest step that shows something.** Each step changes one thing and shows the result before the next step. A reader should never have to hold two new things at once.

**Words for every symbol.** A formula, flag, type or diagram label gets a plain-words reading the first time it appears. Then keep the name stable: do not rename a thing to avoid repeating it.

**Say what would break.** For a design choice, ask what goes wrong without it. The failure explains the choice better than a description of it.

**Close the loop.** End a part with a check the reader can do in their head: predict, spot, or choose. Give the answer right after it, not at the end of the document.

## Code and tools

**Start with the working thing.** Show the smallest program that runs and the exact output, then grow it. The reader sees a result in the first minute.
*Shape:* a three-line program and what it prints; then the same program with one added line and the changed output.

**Run, then read.** Show the code and its output before explaining the code. Explanation lands better after the reader has seen the behaviour.

**Predict the output.** Before showing a result, ask what it will be, then show it. Use it when the answer is not obvious, or when the wrong answer is a common one.

**Break it on purpose.** Show the error the reader will meet, and read the error message aloud: what it says, what it means, what to change. Treat the compiler or tool as a collaborator.

**Reference as a convenience.** Keep options, flags and limits out of the explanation. Put the few the goal needs in one short box at the end.

**Build in small, runnable steps.** For a project chapter, every step leaves code that runs. Say what is new in each step with a diff-sized change, not a full listing each time.

## Systems

**Follow one request.** Pick a single concrete operation (one write, one query) and trace it through every part. Name the parts as the request reaches them.
*Shape:* "a client sends X; first it reaches A, which does Y; A hands it to B…", then a diagram of the same path.

**Then break a part.** After the happy path, take one component away or slow it down and trace what happens. Each failure motivates the next mechanism.

**One running example.** Keep the same small scenario across a whole chapter, so each new idea adds to something the reader already holds.

**Say what is traded.** Every mechanism buys something and costs something. Say both, in that order, in one sentence each.

**Draw before explaining.** When the point is a relationship between parts, put the diagram first and walk through it. Keep one diagram to one idea.

## Math and science

**Open with the puzzle.** Start from the question or the thing that does not work yet, not the definition. The reader should want the idea before they get it.

**Invent the idea.** Show why the quantity or equation has the form it has, as something the reader could have arrived at, then name it.

**Picture before formalism.** Show the figure, then the symbols. Bring the notation in only after the reader holds the picture, and say what each symbol stands for in plain words.

**One plain sentence per formula.** Next to every formula, say in one sentence what it claims.

**Say the surprise out loud.** If a result is counter-intuitive, say so and say why it should be surprising before explaining why it is true.

**Start from something touched.** Begin from a thing the reader has handled or seen (counting, a clock, water in a bath), then climb to the abstract version one rung at a time.

**Stakes and a little history.** One or two sentences on why people cared, where it helps the idea exist for the reader. No longer.

**Analogies are a first-class move here.** Use one whenever it carries the structure of the idea, and do not hold back because it is "usually done". Rules:
- Say plainly that it is an analogy.
- Say where it breaks. A good analogy is honest about its limit.
- It adds no fact about the subject the pack does not state. The fact check covers what the analogy implies about the subject, not the thing it compares to.
- Do not reuse the same analogy twice in a document.

## Do not

- Do not imitate a style. If a sentence sounds like a famous person's catchphrase, rewrite it.
- Do not open with "Let's dive in", "In this guide", "Welcome" or any greeting.
- Do not use every move. Variety comes from need, not from rotation.
- Do not add enthusiasm words ("amazing", "beautiful", "simply", "just") where a fact would do.
