import {createSignal, createResource, createEffect} from 'solid-js'

export const Comp1 = () => {
	const [count, setCount] = createSignal(0)
	const increment = () => setCount(count() + 1)
	console.log('rendered') // This will be printed only once even though you increment/decrement multiple times coz component code is executed only once.
	return (
		<div>
			<button onClick={increment}>{count()}</button>
		</div>
	)
}

const fetchUser = async (id) => (await fetch(`https://swapi.dev/api/people/${id}/`)).json()

export const Comp2 = () => {
	// src: https://codesandbox.io/s/2o4wmxj9zy?file=/index.js
	const [userId, setUserId] = createSignal()
	// const [userId, setUserId] = createSignal(5) // We can give initial value to createSignal as well.

	const [user] = createResource(userId, fetchUser)
	console.log('user: ', user())

	return (
		<div>
			<button onClick={() => setUserId(3)}>Click to fetch user 3</button>
			<br />
			<b>User:</b> <pre>{JSON.stringify(user(), null, 2) ?? 'NO DATA YET'} </pre>
		</div>
	)
}

// MAGIC: Comp3's components (C4, C5) share common state and common state handler function. And it works magically.
const [count, setCount] = createSignal(0)
const increment = () => setCount(count() + 1)

export const Comp3 = () => {
	return (
		<>
			<Comp4 />
			<Comp5 />
		</>
	)
}

// createEffect is like useEffect but it manages its dependency array dynamically by looking for code if it uses the state then only it the effect would be run.

const Comp4 = () => {
	// we could have put above counter atom and increment function in here too, and it would work same.
	createEffect(() => {
		// effect1 is only once executed on initial componente render.
		console.log('effect1')
	})

	createEffect(() => {
		// effect2 is run on every count value change coz it tracks internally if the effect has something that has changed!.
		console.log('effect2:: count: ', count())
	})

	return (
		<div>
			<button onClick={increment}>{count()}</button>
		</div>
	)
}

const Comp5 = () => {
	createEffect(() => {
		// effect1 is only once executed on initial componente render.
		console.log('effect1 (comp5)')
	})

	createEffect(() => {
		// effect2 is run on every count value change coz it tracks internally if the effect has something that has changed!.
		console.log('effect2(comp5):: count: ', count())
	})

	return (
		<div>
			<button onClick={increment}>{count()}</button>
		</div>
	)
}
